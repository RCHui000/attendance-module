"""
Two-stage opportunity agent for public tender announcements.

Stage 1 uses deterministic rules to identify obvious opportunities and noise.
Stage 2 calls an OpenAI-compatible chat completion API for fine-grained labels.
"""

import json
import re
import time
import urllib.request
from dataclasses import dataclass, field
from html import unescape
from typing import Any


DEFAULT_AGENT_API_BASE = "https://api.deepseek.com/v1"
DEFAULT_AGENT_MODEL = "deepseek-chat"

CORE_BUSINESS_KEYWORDS = [
    "全过程工程咨询", "全过程咨询", "全过程造价", "造价咨询",
    "项目管理", "建设项目管理", "工程项目管理",
    "代建", "项目代建", "代建管理",
]
SCOPE_KEYWORDS = ["造价", "全过程", "概算", "预算", "控制价", "结算", "重计量", "项目管理", "代建"]
EXCLUDED_BUSINESS_KEYWORDS = [
    "招标代理", "监理", "施工监理", "工程监理",
    "epc", "工程总承包", "设计施工总承包",
    "勘察设计", "方案设计", "初步设计", "施工图设计", "深化设计", "设计",
    "bim",
]
LLM_EXCERPT_KEYWORDS = [
    "全过程工程咨询", "全过程咨询", "全过程造价", "造价咨询", "项目管理", "代建",
    "EPC", "工程总承包", "设计施工总承包", "联合体", "BIM", "深化设计",
    "招标代理", "设计", "勘察", "监理", "咨询", "造价", "概算", "预算", "控制价", "结算", "重计量",
    "投标人资格", "资格要求", "资质", "业绩", "人员要求",
]


@dataclass
class AgentRuntimeSettings:
    api_key: str = ""
    api_base: str = DEFAULT_AGENT_API_BASE
    model: str = DEFAULT_AGENT_MODEL
    enabled: bool = False


@dataclass
class RuleResult:
    score: int = 0
    summary: str = "需要精细分析"
    tags: list[str] = field(default_factory=list)
    action: str = "待精判"
    needs_llm: bool = True
    confidence: float = 0.35


@dataclass
class AgentResult:
    opportunity_score: int = 0
    relevant: bool = False
    confidence: float = 0.0
    analysis: str = ""
    tags: list[str] = field(default_factory=list)
    suggested_action: str = ""
    business_category: str = ""
    key_requirements: str = ""
    risk_flags: list[str] = field(default_factory=list)


def _load_runtime_settings() -> AgentRuntimeSettings:
    try:
        from app.storage import get_agent_settings

        settings = get_agent_settings()
        api_key = settings.api_key
        api_base = settings.api_base or DEFAULT_AGENT_API_BASE
        model = settings.model or DEFAULT_AGENT_MODEL
        enabled = bool(settings.enabled and api_key)
        return AgentRuntimeSettings(
            api_key=api_key,
            api_base=api_base.rstrip("/"),
            model=model,
            enabled=enabled,
        )
    except Exception:
        return AgentRuntimeSettings(api_base=DEFAULT_AGENT_API_BASE.rstrip("/"), model=DEFAULT_AGENT_MODEL)


SYSTEM_PROMPT = """你是专业的招投标商机研判 Agent。
用户是一家以项目管理、造价咨询、全过程咨询、代建为核心业务的工程咨询公司。
重要边界：用户无法承接监理、招标代理、设计、EPC、工程总承包、设计施工总承包、BIM、深化设计相关业务。
你需要结合规则初筛信息与公告关键摘录，判断该公告是否值得用户关注，并输出严格 JSON。

评分标准：
5 分：直接匹配核心业务，例如全过程工程咨询、全过程咨询、造价咨询、项目管理、代建等。
4 分：核心业务高度相关，例如招标范围中明确包含项目管理、造价控制、概算、预算、控制价、结算、重计量等服务。
3 分：可关注，但必须存在项目管理、造价咨询、全过程咨询或代建线索。
2 分：弱相关，仅建议观察。
1 分：不相关或不推荐，例如纯施工、纯设备采购、材料采购，或仅涉及监理、招标代理、设计、EPC、工程总承包、设计施工总承包、BIM、深化设计等用户无法承接的业务。

若公告只出现监理、招标代理、设计、EPC、工程总承包、设计施工总承包、BIM、深化设计，而没有项目管理、造价咨询、全过程咨询、代建线索，必须评分 1 分，suggested_action 为“不推荐”，并在 risk_flags 中说明不可承接业务。

请严格返回 JSON，不要返回 Markdown 或额外解释。JSON 字段如下：
{
  "opportunity_score": 1-5,
  "relevant": true/false,
  "confidence": 0.0-1.0,
  "analysis": "80字以内说明判断依据",
  "tags": ["标签1", "标签2"],
  "suggested_action": "重点跟进 / 联合体评估 / 关注后续 / 观察 / 不推荐",
  "business_category": "咨询 / 施工 / 设计 / 监理 / 勘察 / 设备 / 其他",
  "key_requirements": "关键资质要求，如无则写空字符串",
  "risk_flags": ["风险或排除因素"]
}
"""


USER_PROMPT_TEMPLATE = """请分析以下招标公告：

【规则初筛】{rule_context}
【来源】{source_name}
【标题】{title}
【发布时间】{publish_time}
【项目名称】{project_name}
【招标人】{tenderer}
【标段名称】{bid_section_name}
【工程类型】{engineering_type}
【招标方式】{bid_method}
【截止时间】{bid_deadline}
【区域】{region}

【公告关键摘录】
{detail_excerpt}
"""


def classify_by_rules(
    title: str,
    engineering_type: str = "",
    detail_content: str = "",
    project_name: str = "",
    bid_section_name: str = "",
    tenderer: str = "",
) -> RuleResult:
    title_text = " ".join([title, project_name, bid_section_name]).lower()
    text = " ".join([title, engineering_type, project_name, bid_section_name, tenderer, detail_content[:2500]]).lower()

    negative_signals = ["更正公告", "变更公告", "流标", "废标", "终止", "资格预审结果", "设备采购", "材料采购", "甲供物资", "货物采购"]
    for kw in negative_signals:
        if kw.lower() in text:
            return RuleResult(score=1, summary=f"规则初筛不推荐：含“{kw}”。", tags=[kw, "不推荐"], action="不推荐", needs_llm=False, confidence=0.82)

    core_hits = [kw for kw in CORE_BUSINESS_KEYWORDS if kw.lower() in text]
    for kw in core_hits:
        if kw.lower() in text:
            return RuleResult(score=5, summary=f"规则初筛直接契合：含“{kw}”。", tags=[kw, "咨询服务"], action="重点跟进", needs_llm=True, confidence=0.8)

    excluded_hits = _matched_keywords(text, EXCLUDED_BUSINESS_KEYWORDS)
    if excluded_hits:
        label = "、".join(excluded_hits[:3])
        return RuleResult(
            score=1,
            summary=f"规则初筛不推荐：含“{label}”，属于用户无法承接业务，且未发现项目管理/造价/全过程咨询/代建线索。",
            tags=[*excluded_hits[:3], "不可承接", "不推荐"],
            action="不推荐",
            needs_llm=False,
            confidence=0.86,
        )

    scope_section = extract_project_scope_section(detail_content)
    scope_hits = [kw for kw in SCOPE_KEYWORDS if kw.lower() in scope_section.lower()]
    if scope_hits:
        return RuleResult(score=3, summary=f"规则初筛可关注：项目概况和招标范围含“{'、'.join(scope_hits)}”。", tags=["项目概况", *scope_hits], action="关注后续", needs_llm=True, confidence=0.68)

    watch_signals = ["咨询", "工程咨询"]
    for kw in watch_signals:
        if kw.lower() in text:
            return RuleResult(score=2, summary=f"规则初筛弱相关：仅含泛化“{kw}”，未发现核心业务线索。", tags=[kw, "弱相关"], action="观察", needs_llm=True, confidence=0.55)

    pure_construction = "施工" in text and not any(kw.lower() in text for kw in CORE_BUSINESS_KEYWORDS + ["咨询", "管理", "造价", "代建"])
    if pure_construction:
        return RuleResult(score=1, summary="规则初筛不推荐：纯施工项目，未发现咨询/设计/管理/造价机会。", tags=["施工", "不推荐"], action="不推荐", needs_llm=False, confidence=0.72)

    if not detail_content:
        return RuleResult(score=0, summary="详情未抓取，暂不能研判。", tags=[], action="待抓详情", needs_llm=False, confidence=0.1)

    return RuleResult()


def _matched_keywords(text: str, keywords: list[str]) -> list[str]:
    hits: list[str] = []
    for keyword in keywords:
        if keyword.lower() in text and keyword not in hits:
            hits.append(keyword.upper() if keyword == "epc" else keyword)
    return hits


def extract_project_scope_section(detail_content: str) -> str:
    text = _html_to_text(detail_content)
    if not text:
        return ""
    start_match = re.search(r"(?:二|2|Ⅱ)[、.．\s]*项目概况[和与]招标范围|项目概况[和与]招标范围", text)
    if not start_match:
        return extract_shenzhen_tender_content(detail_content)
    tail = text[start_match.start():]
    end_match = re.search(r"\n\s*(?:三|3|Ⅲ)[、.．\s]*投标人资格要求|投标人资格要求", tail)
    return tail[: end_match.start()] if end_match else tail[:3000]


def extract_shenzhen_tender_content(detail_content: str) -> str:
    text = _html_to_text(detail_content)
    if not text:
        return ""
    detail_start = text.find("详细公告内容")
    search_text = text[detail_start:] if detail_start >= 0 else text
    start_match = re.search(r"本次招标内容", search_text)
    if not start_match:
        return ""
    tail = search_text[start_match.start():]
    end_match = re.search(
        r"\n\s*(?:本次发包工程估价|招标范围|计划总投资|工程地址|投标补偿|拟采用评标方法|投标文件递交方式|是否接受联合体投标)",
        tail,
    )
    return tail[: end_match.start()] if end_match else tail[:1800]


def build_llm_excerpt(
    detail_content: str,
    source_name: str = "",
    source_key: str = "",
    max_chars: int = 6000,
) -> str:
    text = _html_to_text(detail_content)
    if not text:
        return "公告详情未抓取。"

    sections: list[tuple[str, str]] = []
    is_shenzhen = source_key == "shenzhen_jsgc_zbgg" or "深圳" in source_name
    if is_shenzhen:
        tender_content = extract_shenzhen_tender_content(detail_content)
        if tender_content:
            sections.append(("本次招标内容", tender_content))

    project_scope = "" if is_shenzhen else extract_project_scope_section(detail_content)
    if project_scope:
        sections.append(("项目概况和招标范围", project_scope))

    qualification = _extract_section_by_heading(
        text,
        [
            "投标人资格要求",
            "申请人资格要求",
            "资格要求",
            "投标人资格条件",
            "投标人应具备",
        ],
    )
    if qualification:
        sections.append(("资格要求", qualification))

    deadline = _extract_section_by_heading(
        text,
        [
            "招标文件的获取",
            "投标文件的递交",
            "递交投标文件",
            "开标时间",
        ],
        max_chars=1200,
    )
    if deadline:
        sections.append(("时间与递交信息", deadline))

    keyword_windows = _keyword_windows(text, LLM_EXCERPT_KEYWORDS, window=220, max_windows=8)
    if keyword_windows:
        sections.append(("关键词上下文", "\n---\n".join(keyword_windows)))

    if not sections:
        sections.append(("公告开头", text[:2500]))

    parts: list[str] = []
    used = 0
    for title, content in sections:
        clean = content.strip()
        if not clean:
            continue
        block = f"【{title}】\n{clean}"
        remaining = max_chars - used
        if remaining <= 0:
            break
        if len(block) > remaining:
            block = block[:remaining] + "\n...[摘录截断]"
        parts.append(block)
        used += len(block) + 2
    return "\n\n".join(parts) or text[:max_chars]


def _extract_section_by_heading(text: str, headings: list[str], max_chars: int = 2200) -> str:
    pattern = "|".join(re.escape(heading) for heading in headings)
    start_match = re.search(pattern, text, flags=re.I)
    if not start_match:
        return ""
    tail = text[start_match.start():]
    search_from = max(1, start_match.end() - start_match.start())
    end_match = re.search(r"\n\s*(?:[一二三四五六七八九十]|\d+)[、.．\s]", tail[search_from:])
    if end_match:
        end_index = search_from + end_match.start()
        tail = tail[:end_index]
    return tail[:max_chars]


def _keyword_windows(text: str, keywords: list[str], window: int = 220, max_windows: int = 8) -> list[str]:
    windows: list[str] = []
    seen_ranges: list[tuple[int, int]] = []
    lower_text = text.lower()
    for keyword in keywords:
        keyword_lower = keyword.lower()
        start = lower_text.find(keyword_lower)
        if start < 0:
            continue
        left = max(0, start - window)
        right = min(len(text), start + len(keyword) + window)
        if any(left <= old_right and right >= old_left for old_left, old_right in seen_ranges):
            continue
        seen_ranges.append((left, right))
        windows.append(text[left:right].strip())
        if len(windows) >= max_windows:
            break
    return windows


def _html_to_text(value: str) -> str:
    text = re.sub(r"<script.*?</script>|<style.*?</style>", " ", value or "", flags=re.I | re.S)
    text = re.sub(r"</(p|div|section|tr|li|h\d)>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text).replace("\xa0", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*", "\n", text)
    return text.strip()


def quick_classify(title: str, engineering_type: str, detail_content: str) -> tuple[int, str]:
    result = classify_by_rules(title, engineering_type, detail_content)
    return result.score, result.summary


def analyze_announcement(
    title: str,
    detail_content: str,
    source_name: str = "",
    source_key: str = "",
    publish_time: str = "",
    project_name: str = "",
    tenderer: str = "",
    bid_section_name: str = "",
    engineering_type: str = "",
    bid_method: str = "",
    bid_deadline: str = "",
    region: str = "",
    rule_context: str = "",
) -> AgentResult | None:
    settings = _load_runtime_settings()
    if not settings.enabled or not settings.api_key:
        return None

    detail_excerpt = build_llm_excerpt(detail_content, source_name=source_name, source_key=source_key)
    user_prompt = USER_PROMPT_TEMPLATE.format(
        rule_context=rule_context or "无",
        source_name=source_name or "未知",
        title=title or "未知",
        publish_time=publish_time or "未知",
        project_name=project_name or "未提供",
        tenderer=tenderer or "未提供",
        bid_section_name=bid_section_name or "未提供",
        engineering_type=engineering_type or "未标注",
        bid_method=bid_method or "未提供",
        bid_deadline=bid_deadline or "未提供",
        region=region or "未提供",
        detail_excerpt=detail_excerpt,
    )

    if len(user_prompt) > 8000:
        user_prompt = user_prompt[:7800] + "\n\n... [公告摘录已截断]"

    payload = {
        "model": settings.model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "max_tokens": 800,
        "response_format": {"type": "json_object"},
    }

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Authorization": f"Bearer {settings.api_key}", "Content-Type": "application/json", "Accept": "application/json"}

    for attempt in range(3):
        try:
            request = urllib.request.Request(f"{settings.api_base}/chat/completions", data=data, headers=headers, method="POST")
            with urllib.request.urlopen(request, timeout=60) as response:
                result = json.loads(response.read().decode("utf-8"))
            content = result["choices"][0]["message"]["content"]
            parsed = _loads_json_object(content)
            return _parse_agent_result(parsed)
        except Exception as exc:
            if attempt < 2:
                time.sleep(2**attempt)
            else:
                print(f"[Agent] Failed to analyze after 3 attempts: {exc}")
                return None
    return None


def _loads_json_object(content: str) -> dict[str, Any]:
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, re.S)
        if not match:
            raise
        parsed = json.loads(match.group(0))
    if not isinstance(parsed, dict):
        raise ValueError("LLM response is not a JSON object")
    return parsed


def _parse_agent_result(parsed: dict[str, Any]) -> AgentResult:
    score = int(parsed.get("opportunity_score", 0) or 0)
    score = max(1, min(5, score))
    confidence = float(parsed.get("confidence", 0.0) or 0.0)
    confidence = max(0.0, min(1.0, confidence))
    tags = parsed.get("tags") or []
    risk_flags = parsed.get("risk_flags") or []
    business_category = _normalize_business_category(
        str(parsed.get("business_category", "")),
        tags=[str(tag) for tag in tags],
        analysis=str(parsed.get("analysis", "")),
    )
    return AgentResult(
        opportunity_score=score,
        relevant=bool(parsed.get("relevant", score >= 3)),
        confidence=confidence,
        analysis=str(parsed.get("analysis", "")),
        tags=[str(tag) for tag in tags if str(tag).strip()],
        suggested_action=str(parsed.get("suggested_action", "")),
        business_category=business_category,
        key_requirements=str(parsed.get("key_requirements", "")),
        risk_flags=[str(flag) for flag in risk_flags if str(flag).strip()],
    )


def _normalize_business_category(value: str, tags: list[str], analysis: str) -> str:
    allowed = {"咨询", "施工", "设计", "监理", "勘察", "设备", "其他"}
    clean = value.strip()
    if clean in allowed:
        return clean

    text = " ".join([clean, analysis, *tags]).lower()
    if any(kw.lower() in text for kw in CORE_BUSINESS_KEYWORDS + ["咨询", "造价", "全过程", "项目管理", "代建"]):
        return "咨询"
    if any(kw in text for kw in ["设备", "材料", "货物"]):
        return "设备"
    if "监理" in text:
        return "监理"
    if any(kw in text for kw in ["设计", "epc", "工程总承包"]):
        return "设计"
    if "勘察" in text:
        return "勘察"
    if "施工" in text:
        return "施工"
    return "其他"
