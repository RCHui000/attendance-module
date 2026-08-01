import re
import ssl
import asyncio
import time
from datetime import datetime
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urljoin, urlparse

from app.config import BOT_UA, BROWSER_UA, DEFAULT_TIMEOUT_SECONDS
from app.schemas import ProbeResult, ProbeSignal


CAPTCHA_PATTERNS = [
    r"captcha",
    r"验证码",
    r"滑块",
    r"人机验证",
    r"安全验证",
    r"访问验证",
    r"请完成验证",
]

BLOCK_PATTERNS = [
    r"access denied",
    r"forbidden",
    r"访问受限",
    r"拒绝访问",
    r"请求过于频繁",
    r"too many requests",
    r"blocked",
]

WAF_HEADERS = [
    "cf-ray",
    "x-sucuri-id",
    "x-waf",
    "x-cdn",
    "x-cache",
    "server",
]


class AntiCrawlerDetector:
    def __init__(self, timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS) -> None:
        self.timeout_seconds = timeout_seconds

    async def run(self, source_name: str, url: str) -> ProbeResult:
        normalized_url = str(url)
        signals: list[ProbeSignal] = []
        metrics: dict[str, Any] = {"probes": []}

        robots_url = self._robots_url(normalized_url)
        robots_probe = await self._request("GET", robots_url, BOT_UA)
        metrics["robots"] = robots_probe
        self._inspect_robots(robots_probe, normalized_url, signals)

        bot_get = await self._request("GET", normalized_url, BOT_UA)
        metrics["probes"].append({"name": "bot_get", **bot_get})
        self._inspect_response("bot_get", bot_get, signals)

        head = await self._request("HEAD", normalized_url, BOT_UA)
        metrics["probes"].append({"name": "head", **head})
        self._inspect_response("head", head, signals, html_sensitive=False)

        browser_get = await self._request("GET", normalized_url, BROWSER_UA)
        metrics["probes"].append({"name": "browser_get", **browser_get})
        self._inspect_response("browser_get", browser_get, signals)

        self._compare_user_agents(bot_get, browser_get, signals)
        self._inspect_dynamic_rendering(browser_get, signals)

        score = self._score(signals)
        level = self._level(score, signals)

        return ProbeResult(
            source_name=source_name,
            url=normalized_url,
            level=level,
            score=score,
            summary=self._summary(level, signals),
            recommendation=self._recommendation(level, signals),
            signals=signals,
            metrics=metrics,
            created_at=datetime.now(),
        )

    async def _request(self, method: str, url: str, user_agent: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._request_sync, method, url, user_agent)

    def _request_sync(self, method: str, url: str, user_agent: str) -> dict[str, Any]:
        started = time.perf_counter()
        headers = {
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6",
        }
        request = Request(url, method=method, headers=headers)
        context = ssl.create_default_context()
        try:
            with urlopen(request, timeout=self.timeout_seconds, context=context) as response:
                raw_body = response.read() if method != "HEAD" else b""
                body = self._decode_body(raw_body, response.headers.get("content-type", ""))
                final_url = response.geturl()
                response_headers = dict(response.headers.items())
                status_code = response.status
            elapsed_ms = round((time.perf_counter() - started) * 1000)
            return {
                "ok": True,
                "method": method,
                "url": final_url,
                "status_code": status_code,
                "elapsed_ms": elapsed_ms,
                "final_url_changed": final_url != url,
                "content_length": len(raw_body),
                "headers": self._selected_headers(response_headers),
                "body_sample": body[:800],
                "body_analysis": self._body_analysis(body),
            }
        except HTTPError as exc:
            raw_body = exc.read() if method != "HEAD" else b""
            body = self._decode_body(raw_body, exc.headers.get("content-type", ""))
            elapsed_ms = round((time.perf_counter() - started) * 1000)
            return {
                "ok": True,
                "method": method,
                "url": exc.geturl(),
                "status_code": exc.code,
                "elapsed_ms": elapsed_ms,
                "final_url_changed": exc.geturl() != url,
                "content_length": len(raw_body),
                "headers": self._selected_headers(dict(exc.headers.items())),
                "body_sample": body[:800],
                "body_analysis": self._body_analysis(body),
            }
        except Exception as exc:
            elapsed_ms = round((time.perf_counter() - started) * 1000)
            return {
                "ok": False,
                "method": method,
                "url": url,
                "elapsed_ms": elapsed_ms,
                "error": f"{type(exc).__name__}: {exc}",
            }

    def _inspect_response(
        self,
        probe_name: str,
        probe: dict[str, Any],
        signals: list[ProbeSignal],
        html_sensitive: bool = True,
    ) -> None:
        if not probe.get("ok"):
            signals.append(
                ProbeSignal(
                    name=f"{probe_name}_request_failed",
                    severity="medium",
                    detail=f"请求失败：{probe.get('error')}",
                )
            )
            return

        status_code = int(probe.get("status_code", 0))
        if status_code in {401, 403, 407, 418, 429, 451}:
            signals.append(
                ProbeSignal(
                    name=f"{probe_name}_blocked_status",
                    severity="blocked",
                    detail=f"返回状态码 {status_code}，应暂停自动采集并人工确认。",
                )
            )
        elif status_code >= 500:
            signals.append(
                ProbeSignal(
                    name=f"{probe_name}_server_error",
                    severity="medium",
                    detail=f"返回服务端错误 {status_code}，采集稳定性存疑。",
                )
            )
        elif status_code >= 300:
            signals.append(
                ProbeSignal(
                    name=f"{probe_name}_redirect_or_non_success",
                    severity="low",
                    detail=f"返回非 2xx 状态码 {status_code}。",
                )
            )

        headers = {key.lower(): value for key, value in probe.get("headers", {}).items()}
        if "set-cookie" in headers:
            signals.append(
                ProbeSignal(
                    name=f"{probe_name}_sets_cookie",
                    severity="low",
                    detail="响应设置 Cookie，后续采集需要保持会话一致性。",
                )
            )

        server_text = " ".join(headers.values()).lower()
        if any(token in server_text for token in ["waf", "cloudflare", "aliyun", "sucuri", "incapsula"]):
            signals.append(
                ProbeSignal(
                    name=f"{probe_name}_waf_like_header",
                    severity="medium",
                    detail="响应头中出现 WAF/CDN/安全网关特征。",
                )
            )

        if html_sensitive:
            body_analysis = probe.get("body_analysis", {})
            if body_analysis.get("captcha"):
                signals.append(
                    ProbeSignal(
                        name=f"{probe_name}_captcha_page",
                        severity="blocked",
                        detail="页面内容疑似包含验证码或人机验证。",
                    )
                )
            if body_analysis.get("blocked_text"):
                signals.append(
                    ProbeSignal(
                        name=f"{probe_name}_blocked_text",
                        severity="high",
                        detail="页面内容疑似包含访问拒绝或请求频繁提示。",
                    )
                )

    def _inspect_robots(self, probe: dict[str, Any], target_url: str, signals: list[ProbeSignal]) -> None:
        if not probe.get("ok") or probe.get("status_code") != 200:
            signals.append(
                ProbeSignal(
                    name="robots_unavailable",
                    severity="low",
                    detail="未能读取 robots.txt，需按目标站点公开规则人工复核。",
                )
            )
            return

        path = urlparse(target_url).path or "/"
        body = probe.get("body_sample", "")
        if self._robots_disallows_path(body, path):
            signals.append(
                ProbeSignal(
                    name="robots_disallow",
                    severity="high",
                    detail=f"robots.txt 可能限制访问路径 {path}，建议暂停自动采集并人工确认。",
                )
            )

    def _compare_user_agents(
        self,
        bot_get: dict[str, Any],
        browser_get: dict[str, Any],
        signals: list[ProbeSignal],
    ) -> None:
        if not bot_get.get("ok") or not browser_get.get("ok"):
            return

        bot_status = bot_get.get("status_code")
        browser_status = browser_get.get("status_code")
        if bot_status != browser_status:
            severity = "high" if bot_status in {403, 429} else "medium"
            signals.append(
                ProbeSignal(
                    name="ua_sensitive_status",
                    severity=severity,
                    detail=f"不同 User-Agent 返回状态不同：bot={bot_status}, browser={browser_status}。",
                )
            )

        bot_len = max(int(bot_get.get("content_length", 0)), 1)
        browser_len = max(int(browser_get.get("content_length", 0)), 1)
        ratio = max(bot_len, browser_len) / min(bot_len, browser_len)
        if ratio >= 3:
            signals.append(
                ProbeSignal(
                    name="ua_sensitive_content",
                    severity="medium",
                    detail=f"不同 User-Agent 页面大小差异明显：bot={bot_len}, browser={browser_len}。",
                )
            )

    def _inspect_dynamic_rendering(self, probe: dict[str, Any], signals: list[ProbeSignal]) -> None:
        if not probe.get("ok"):
            return
        body = probe.get("body_sample", "")
        analysis = probe.get("body_analysis", {})
        if analysis.get("script_count", 0) >= 12 and analysis.get("link_count", 0) <= 3:
            signals.append(
                ProbeSignal(
                    name="likely_dynamic_rendering",
                    severity="medium",
                    detail="页面脚本较多且静态链接较少，公告列表可能依赖前端渲染或接口加载。",
                )
            )
        if "__NUXT__" in body or "__NEXT_DATA__" in body or "webpackJsonp" in body:
            signals.append(
                ProbeSignal(
                    name="spa_framework_detected",
                    severity="medium",
                    detail="检测到 SPA/前端框架特征，可能需要 Playwright 做只读渲染探测。",
                )
            )

    def _body_analysis(self, body: str) -> dict[str, Any]:
        lower_body = body.lower()
        title_match = re.search(r"<title[^>]*>(.*?)</title>", body, re.IGNORECASE | re.DOTALL)
        title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else ""
        return {
            "captcha": any(re.search(pattern, body, re.IGNORECASE) for pattern in CAPTCHA_PATTERNS),
            "blocked_text": any(re.search(pattern, lower_body, re.IGNORECASE) for pattern in BLOCK_PATTERNS),
            "title": title,
            "script_count": len(re.findall(r"<script\b", body, re.IGNORECASE)),
            "link_count": len(re.findall(r"<a\b", body, re.IGNORECASE)),
        }

    def _selected_headers(self, headers: dict[str, str]) -> dict[str, str]:
        selected: dict[str, str] = {}
        for key, value in headers.items():
            lower_key = key.lower()
            if lower_key in WAF_HEADERS or lower_key in {"content-type", "set-cookie", "location"}:
                selected[lower_key] = value[:500]
        return selected

    def _decode_body(self, raw_body: bytes, content_type: str) -> str:
        charset_match = re.search(r"charset=([\w-]+)", content_type, re.IGNORECASE)
        encodings = [charset_match.group(1)] if charset_match else []
        encodings.extend(["utf-8", "gb18030"])
        for encoding in encodings:
            try:
                return raw_body[:120_000].decode(encoding, errors="replace")
            except LookupError:
                continue
        return raw_body[:120_000].decode("utf-8", errors="replace")

    def _robots_url(self, url: str) -> str:
        parsed = urlparse(url)
        return f"{parsed.scheme}://{parsed.netloc}/robots.txt"

    def _robots_disallows_path(self, robots_text: str, path: str) -> bool:
        applies = False
        for raw_line in robots_text.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            key, _, value = line.partition(":")
            key = key.strip().lower()
            value = value.strip()
            if key == "user-agent":
                applies = value == "*"
            elif applies and key == "disallow" and value:
                if path.startswith(value):
                    return True
        return False

    def _score(self, signals: list[ProbeSignal]) -> int:
        weights = {"low": 8, "medium": 22, "high": 38, "blocked": 100}
        return min(sum(weights.get(signal.severity, 0) for signal in signals), 100)

    def _level(self, score: int, signals: list[ProbeSignal]) -> str:
        if any(signal.severity == "blocked" for signal in signals):
            return "blocked"
        if score >= 70:
            return "high"
        if score >= 30:
            return "medium"
        return "low"

    def _summary(self, level: str, signals: list[ProbeSignal]) -> str:
        if not signals:
            return "未发现明显反爬信号，可进入低频公告列表解析验证。"
        severe = [signal for signal in signals if signal.severity in {"blocked", "high"}]
        if severe:
            return f"发现 {len(severe)} 个强反爬或阻断信号，当前强度为 {level}。"
        return f"发现 {len(signals)} 个轻中度限制信号，当前强度为 {level}。"

    def _recommendation(self, level: str, signals: list[ProbeSignal]) -> str:
        signal_names = {signal.name for signal in signals}
        if level == "blocked":
            return "暂停自动采集；记录状态码和页面证据，人工确认站点规则后再决定是否只保留人工入口。"
        if "robots_disallow" in signal_names:
            return "robots.txt 可能限制目标路径，建议先完成合规复核。"
        if level == "high":
            return "暂不接入常规爬虫；可人工确认是否存在官方 API、订阅源或授权方式。"
        if level == "medium":
            return "可做低频只读采集 PoC；建议固定请求间隔、保持会话 Cookie，并准备 Playwright 渲染兜底。"
        return "可优先使用标准 HTTP 客户端做低频列表采集，并保留失败日志与自动暂停策略。"
