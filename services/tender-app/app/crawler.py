import json
import os
import random
import re
import subprocess
import time
from datetime import datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urljoin, quote
from urllib.request import Request, urlopen

from app.schemas import Announcement, CrawlSummary, SourceCrawlRun
from app.storage import (
    get_announcements_for_agent,
    get_source_state,
    list_source_configs,
    record_source_failure,
    record_source_success,
    prune_old_announcements,
    save_agent_result,
    save_announcements,
    save_source_crawl_run,
    update_announcement_detail,
)

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0 Safari/537.36"
)


class CrawlBlocked(Exception):
    pass


class PoliteHttpClient:
    def __init__(self, min_delay: float = 1.0, max_delay: float = 2.5, timeout: int = 25) -> None:
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.timeout = timeout
        self.last_request_at = 0.0

    def get_text(self, url: str, referer: str | None = None) -> str:
        self._wait()
        headers = self._headers(referer)
        request = Request(url, headers=headers)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
                self._guard_response(response.status, raw[:2000])
                return self._decode(raw)
        except HTTPError as exc:
            raw = exc.read()
            self._guard_response(exc.code, raw[:2000])
            return self._decode(raw)
        except Exception:
            try:
                return self._curl_cffi_get(url, referer)
            except Exception:
                return self._curl_get(url, referer)

    def post_json(self, url: str, payload: dict[str, Any], referer: str | None = None) -> dict[str, Any]:
        self._wait()
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers = self._headers(referer)
        headers.update({"Content-Type": "application/json;charset=UTF-8", "Accept": "application/json"})
        request = Request(url, data=data, headers=headers, method="POST")
        with urlopen(request, timeout=self.timeout) as response:
            raw = response.read()
            self._guard_response(response.status, raw[:2000])
            return json.loads(self._decode(raw))

    def get_json(self, url: str, referer: str | None = None) -> dict[str, Any]:
        self._wait()
        headers = self._headers(referer)
        headers.update({"Accept": "application/json"})
        request = Request(url, headers=headers)
        with urlopen(request, timeout=self.timeout) as response:
            raw = response.read()
            self._guard_response(response.status, raw[:2000])
            return json.loads(self._decode(raw))

    def _headers(self, referer: str | None = None) -> dict[str, str]:
        headers = {
            "User-Agent": BROWSER_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6",
        }
        if referer:
            headers["Referer"] = referer
        return headers

    def _wait(self) -> None:
        elapsed = time.perf_counter() - self.last_request_at
        delay = random.uniform(self.min_delay, self.max_delay)
        if elapsed < delay:
            time.sleep(delay - elapsed)
        self.last_request_at = time.perf_counter()

    def _curl_get(self, url: str, referer: str | None = None) -> str:
        cmd = [
            "curl.exe" if os.name == "nt" else "curl", "-sS", "-L", "--max-time", str(self.timeout),
            "-H", f"User-Agent: {BROWSER_UA}",
            "-H", "Accept-Language: zh-CN,zh;q=0.9,en;q=0.6",
        ]
        if referer:
            cmd.extend(["-H", f"Referer: {referer}"])
        cmd.append(url)
        result = subprocess.run(cmd, capture_output=True, check=True)
        raw = result.stdout
        self._guard_response(200, raw[:2000])
        return self._decode(raw)

    def _curl_cffi_get(self, url: str, referer: str | None = None) -> str:
        from curl_cffi import requests

        headers = self._headers(referer)
        response = requests.get(
            url,
            headers=headers,
            impersonate="chrome",
            timeout=self.timeout,
        )
        raw = response.content
        self._guard_response(response.status_code, raw[:2000])
        return self._decode(raw)

    def _guard_response(self, status_code: int, body_sample: bytes) -> None:
        text = self._decode(body_sample).lower()
        if status_code in {401, 403, 407, 418, 429, 451}:
            raise CrawlBlocked(f"blocked status {status_code}")
        if any(token in text for token in ["captcha", "验证码", "人机验证", "请求频繁", "访问受限"]):
            raise CrawlBlocked("captcha or access-limit page detected")

    def _decode(self, raw: bytes) -> str:
        for encoding in ("utf-8", "gb18030"):
            try:
                return raw.decode(encoding)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", errors="replace")


class BeijingListParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.items: list[dict[str, str]] = []
        self.capture_title_text = False
        self.capture_date = False
        self.last_anchor: dict[str, str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {key: value or "" for key, value in attrs}
        if tag == "a" and "divtitlejy" in attr.get("class", ""):
            self.last_anchor = {
                "title": attr.get("title", "").strip(),
                "url": urljoin("https://ggzyfw.beijing.gov.cn/", attr.get("href", "")),
            }
            self.capture_title_text = True
        if tag == "p" and self.last_anchor is not None:
            self.capture_date = True

    def handle_data(self, data: str) -> None:
        text = re.sub(r"\s+", " ", data).strip()
        if not text:
            return
        if self.capture_title_text and self.last_anchor and not self.last_anchor.get("title"):
            self.last_anchor["title"] = text
        elif self.capture_date and self.last_anchor and re.match(r"\d{4}-\d{2}-\d{2}", text):
            item = dict(self.last_anchor)
            item["publish_time"] = text
            self.items.append(item)
            self.last_anchor = None
            self.capture_date = False

    def handle_endtag(self, tag: str) -> None:
        if tag == "a":
            self.capture_title_text = False
        if tag == "p":
            self.capture_date = False


class AnnouncementCrawler:
    max_failures = 3
    _list_page_size = 50
    _list_max_pages = 20
    _detail_batch_size = 30

    def __init__(self) -> None:
        self.client = PoliteHttpClient()

    # ─── Main entry: crawl all enabled sources dynamically ───

    def crawl_all(self, lookback_days: int = 1) -> CrawlSummary:
        messages: list[str] = []
        all_items: list[Announcement] = []
        blocked_count = 0
        source_count = 0
        lookback_days = max(1, min(30, int(lookback_days or 1)))
        today = datetime.now().date()
        target_dates = [today - timedelta(days=offset) for offset in range(lookback_days - 1, -1, -1)]

        configs = list_source_configs()
        for cfg in configs:
            if not cfg.enabled:
                messages.append(f"{cfg.name}: skipped (disabled)")
                continue

            source_key = cfg.source_key
            name = cfg.name
            source_count += 1

            state = get_source_state(source_key, name)
            if state.is_paused:
                blocked_count += 1
                messages.append(f"{name}: skipped (paused after {state.consecutive_failures} failures)")
                continue

            try:
                self._current_source_key = source_key
                self._current_source_name = name
                self._current_list_url = cfg.list_url
                source_items: list[Announcement] = []
                for target_date in target_dates:
                    self._last_crawl_audit = None
                    if cfg.source_type == "shenzhen":
                        items = self.crawl_shenzhen(target_date=target_date)
                    elif cfg.source_type == "beijing":
                        items = self.crawl_beijing(target_date=target_date)
                    else:
                        messages.append(f"{name}: unknown source_type={cfg.source_type}")
                        continue

                    audit = getattr(self, "_last_crawl_audit", None)
                    if audit:
                        save_source_crawl_run(audit)
                        messages.append(
                            f"{name} {audit.crawl_date}: completeness={audit.completeness_status}, "
                            f"pages={len(audit.fetched_pages)}/{audit.expected_total_pages or '?'}, "
                            f"items={audit.fetched_count}, errors={len(audit.error_pages)}"
                        )

                    if not items and (not audit or audit.completeness_status in {"failed", "unknown"}):
                        raise RuntimeError(f"no announcements parsed for {target_date}")
                    source_items.extend(items)
                record_source_success(source_key, name)
                all_items.extend(source_items)
                messages.append(f"{name}: fetched {len(source_items)} announcements across {lookback_days} day(s)")
            except CrawlBlocked as exc:
                blocked_count += 1
                state = record_source_failure(source_key, name, str(exc), self.max_failures)
                pause_text = " and paused" if state.is_paused else ""
                messages.append(f"{name}: blocked {state.consecutive_failures}/{self.max_failures}{pause_text} - {exc}")
            except Exception as exc:
                state = record_source_failure(source_key, name, f"{type(exc).__name__}: {exc}", self.max_failures)
                pause_text = " and paused" if state.is_paused else ""
                messages.append(f"{name}: failed {state.consecutive_failures}/{self.max_failures}{pause_text} - {type(exc).__name__}: {exc}")

        # Save
        inserted, skipped = save_announcements(all_items)

        # Fetch details
        detail_count = 0
        if inserted:
            detail_count = self._fetch_details_batch(inserted)
            messages.append(f"fetched detail for {detail_count}/{len(inserted)} new announcements")

        # Run agent analysis on pending items (with detail, not yet analyzed)
        agent_count = 0
        try:
            agent_result = self.run_agent_pipeline(limit=50)
            agent_count = agent_result["analyzed"]
            if agent_count:
                messages.append(f"agent analyzed {agent_count} announcements")
        except Exception as exc:
            messages.append(f"agent analysis skipped: {exc}")

        pruned_count = prune_old_announcements()
        if pruned_count:
            messages.append(f"pruned {pruned_count} announcements older than 30 days")

        return CrawlSummary(
            source_count=source_count,
            fetched_count=len(all_items),
            inserted_count=len(inserted),
            skipped_count=skipped,
            blocked_count=blocked_count,
            detail_fetched_count=detail_count,
            messages=messages,
            announcements=inserted,
        )

    def fetch_pending_details(self, limit: int | None = None) -> dict[str, Any]:
        from app.storage import get_announcements_without_detail
        pending = get_announcements_without_detail(limit or self._detail_batch_size)
        if not pending:
            return {"fetched": 0, "message": "no pending detail fetches"}
        count = self._fetch_details_batch(pending)
        return {"fetched": count, "message": f"fetched detail for {count}/{len(pending)}"}

    def run_agent_pipeline(
        self,
        limit: int | None = 30,
        fetch_details: bool = False,
        force: bool = False,
    ) -> dict[str, Any]:
        """Run AI agent analysis on announcements that have detail but no analysis yet."""
        detail_fetched = 0
        if fetch_details:
            detail_result = self.fetch_pending_details(limit or 100)
            detail_fetched = int(detail_result.get("fetched", 0))

        pending = get_announcements_for_agent(limit, force=force)
        if not pending:
            return {
                "analyzed": 0,
                "detail_fetched": detail_fetched,
                "results": [],
                "message": "no pending agent analysis",
            }

        from app.agent import analyze_announcement, classify_by_rules

        results: list[dict[str, Any]] = []
        for ann in pending:
            rule_result = classify_by_rules(
                title=ann.title,
                engineering_type=ann.engineering_type,
                detail_content=ann.detail_content,
                project_name=ann.project_name,
                bid_section_name=ann.bid_section_name,
                tenderer=ann.tenderer,
            )
            score = rule_result.score
            summary = rule_result.summary
            tags = ",".join(rule_result.tags)
            action = rule_result.action
            confidence = rule_result.confidence
            stage = "rule"
            error = ""
            inferred_engineering_type = ""
            rule_context = (
                f"score={rule_result.score}; action={rule_result.action}; "
                f"summary={rule_result.summary}; tags={','.join(rule_result.tags) or '?'}"
            )

            if rule_result.needs_llm and ann.detail_content:
                agent_result = analyze_announcement(
                    title=ann.title,
                    detail_content=ann.detail_content,
                    source_name=ann.source_name,
                    source_key=ann.source_key,
                    publish_time=ann.publish_time,
                    project_name=ann.project_name,
                    tenderer=ann.tenderer,
                    bid_section_name=ann.bid_section_name,
                    engineering_type=ann.engineering_type,
                    bid_method=ann.bid_method,
                    bid_deadline=ann.bid_deadline,
                    region=ann.region,
                    rule_context=rule_context,
                )
                if agent_result:
                    score = agent_result.opportunity_score
                    summary = agent_result.analysis
                    tags = ",".join(agent_result.tags)
                    action = agent_result.suggested_action
                    confidence = agent_result.confidence
                    inferred_engineering_type = agent_result.business_category
                    stage = "llm"
                else:
                    stage = "fallback"
                    error = "LLM unavailable or invalid response"
                    if score <= 0:
                        score = 2 if ann.engineering_type != "施工" else 1
                        summary = "LLM 不可用，使用规则兜底判断。"
                        tags = ann.engineering_type or "待复核"
                        action = "观察" if score >= 2 else "不推荐"

            if score <= 0:
                stage = "failed"
                error = "detail unavailable or no rule matched"

            save_agent_result(
                ann_id=ann.id or 0,
                score=score,
                summary=summary,
                tags=tags,
                action=action,
                stage=stage,
                confidence=confidence,
                error=error,
                analyzed=score > 0,
                engineering_type=inferred_engineering_type,
            )
            results.append({"id": ann.id, "score": score, "stage": stage, "summary": summary})

        return {
            "analyzed": len(results),
            "detail_fetched": detail_fetched,
            "results": results[:10],
            "message": f"analyzed {len(results)} announcements",
        }

    # Shenzhen crawler

    def crawl_shenzhen(self, target_date: Any | None = None) -> list[Announcement]:
        endpoint = "https://www.szggzy.com/cms/api/v1/trade/content/page"
        referer = getattr(self, "_current_list_url", "https://www.szggzy.com/jygg/list.html?id=jsgc")
        now = datetime.now()
        started_at = datetime.now()
        target_base = datetime.combine(target_date, datetime.min.time()) if target_date else now
        target_start = target_base.replace(hour=0, minute=0, second=0, microsecond=0)
        target_end = target_base.replace(hour=23, minute=59, second=59, microsecond=0)
        all_items: list[Announcement] = []
        fetched_pages: list[int] = []
        error_pages: list[str] = []
        expected_total_count: int | None = None
        expected_total_pages: int | None = None
        reached_date_boundary = False

        for page in range(self._list_max_pages):
            payload = {
                "modelId": 1378, "channelId": 2851,
                "fields": [
                    {"fieldName": "jygg_gglxmc_rank1", "fieldValue": "招标公告"},
                    {"fieldName": "jygg_gglxmc", "fieldValue": "招标公告"},
                ],
                "jsgcProjectType": "依法必招",
                "parentBusinessType": "", "title": None,
                "releaseTimeBegin": target_start.strftime("%Y-%m-%d %H:%M:%S"),
                "releaseTimeEnd": target_end.strftime("%Y-%m-%d %H:%M:%S"),
                "page": page, "size": self._list_page_size, "siteId": 1,
            }
            try:
                data = self._post_json_with_retry(endpoint, payload, referer=referer)
            except Exception as exc:
                error_pages.append(f"{page}: {type(exc).__name__}: {exc}")
                break
            if data.get("code") != 200:
                error_pages.append(f"{page}: response code {data.get('code')}")
                break
            page_data = data.get("data") or {}
            if expected_total_count is None:
                expected_total_count = page_data.get("totalElements")
                expected_total_pages = page_data.get("totalPages")
            rows = (page_data.get("content") or [])
            fetched_pages.append(page)
            if not rows:
                reached_date_boundary = True
                break
            for row in rows:
                item = self._parse_shenzhen_row(row, now)
                if item:
                    published_at = self._parse_publish_datetime(item.publish_time)
                    if published_at and published_at < target_start:
                        reached_date_boundary = True
                        continue
                    if not published_at or published_at <= target_end:
                        all_items.append(item)
            if len(rows) < self._list_page_size:
                reached_date_boundary = True
                break
            if expected_total_pages is not None and page + 1 >= expected_total_pages:
                reached_date_boundary = True
                break
        hit_page_cap = bool(expected_total_pages and expected_total_pages > self._list_max_pages and len(fetched_pages) >= self._list_max_pages)
        status = self._completeness_status(error_pages, hit_page_cap)
        self._last_crawl_audit = self._build_crawl_audit(
            source_key=getattr(self, "_current_source_key", "shenzhen_jsgc_zbgg"),
            source_name=getattr(self, "_current_source_name", "深圳公共资源交易中心"),
            crawl_date=target_start.strftime("%Y-%m-%d"),
            target_start=target_start,
            target_end=target_end,
            expected_total_count=expected_total_count,
            expected_total_pages=expected_total_pages,
            fetched_pages=fetched_pages,
            items=all_items,
            reached_date_boundary=reached_date_boundary,
            hit_page_cap=hit_page_cap,
            error_pages=error_pages,
            completeness_status=status,
            started_at=started_at,
        )
        return all_items

    def _parse_shenzhen_row(self, row: dict[str, Any], now: datetime) -> Announcement | None:
        title = self._repair_mojibake(row.get("title", ""))
        notice_type = self._repair_mojibake(row.get("rank1NoticeTypeName") or row.get("noticeTypeName") or "招标公告")
        notice_sub_type = self._repair_mojibake(row.get("noticeTypeName") or "招标公告")
        if notice_sub_type != "招标公告":
            return None
        content_id = str(row.get("id") or row.get("contentId") or "")
        bid_section_number = str(row.get("bidSectionNumber") or "")
        detail_url = (
            "https://www.szggzy.com/jyfw/ggDetails.html"
            f"?contentId={quote(content_id)}&noticeType={quote(notice_type)}"
            f"&bidSectionNumber={quote(bid_section_number)}&crumb=jsgc"
        )
        return Announcement(
            source_name=getattr(self, "_current_source_name", "深圳公共资源交易中心"),
            source_key=getattr(self, "_current_source_key", "shenzhen_jsgc_zbgg"),
            title=title, url=detail_url,
            publish_time=row.get("releaseTime") or row.get("publishTime") or "",
            notice_type=notice_type, notice_sub_type=notice_sub_type,
            region=self._repair_mojibake(row.get("projectRegion") or row.get("areaName") or ""),
            project_name=self._repair_mojibake(row.get("projectName") or row.get("tenderProjectName") or ""),
            project_code=str(row.get("projectCode") or row.get("tenderProjectNumber") or ""),
            bid_section_name=self._repair_mojibake(row.get("bidSectionName") or ""),
            tenderer=self._repair_mojibake(row.get("tenderer") or row.get("tenderer2") or ""),
            bid_deadline=str(row.get("noticeCloseTime") or ""),
            engineering_type=self._repair_mojibake(row.get("projectType") or ""),
            bid_method=self._repair_mojibake(row.get("tradeType") or ""),
            raw=row, first_seen_at=now,
        )

    def fetch_shenzhen_detail(self, announcement: Announcement) -> Announcement | None:
        match = re.search(r"contentId=(\d+)", announcement.url)
        if not match:
            return None
        content_id = match.group(1)
        detail_url = f"https://www.szggzy.com/cms/api/v1/trade/content/detail?contentId={content_id}"
        referer = announcement.url
        try:
            data = self.client.get_json(detail_url, referer=referer)
        except Exception:
            return None
        if data.get("code") != 200:
            return None
        detail = data.get("data") or {}
        txt = detail.get("txt", "")
        attrs_list: list[dict[str, str]] = detail.get("attrs", [])
        attrs: dict[str, str] = {}
        for attr in attrs_list:
            name = attr.get("attrName", "")
            value = attr.get("attrValue") or ""
            attrs[name] = self._repair_mojibake(value)
        merged = {
            "bid_deadline": announcement.bid_deadline or attrs.get("jygg_ggjssj", ""),
            "project_name": announcement.project_name or attrs.get("jygg_xmmc", ""),
            "tenderer": announcement.tenderer or attrs.get("jygg_jzdw", ""),
            "engineering_type": announcement.engineering_type or attrs.get("jygg_gclx", ""),
            "bid_method": announcement.bid_method or attrs.get("jygg_jyfs", ""),
            "region": announcement.region or attrs.get("jygg_xmqy", ""),
        }
        update_announcement_detail(
            ann_id=announcement.id or 0, detail_content=txt, detail_attrs=attrs,
            **merged,
        )
        return announcement.model_copy(update={"detail_content": txt, "detail_fetched": True, **merged})

    # ─── Beijing crawler ───────────────────────────────────
    _bj_max_pages = 60  # safety cap

    def crawl_beijing(self, target_date: Any | None = None) -> list[Announcement]:
        """Crawl Beijing ggzyfw paginated pages. Only collects 招标公告."""
        list_url = getattr(self, "_current_list_url", "https://ggzyfw.beijing.gov.cn/jyxxggjtbyqs/index.html")
        base = list_url.rsplit("/", 1)[0]
        now = datetime.now()
        started_at = datetime.now()
        target_base = datetime.combine(target_date, datetime.min.time()) if target_date else now
        target_start = target_base.replace(hour=0, minute=0, second=0, microsecond=0)
        target_end = target_base.replace(hour=23, minute=59, second=59, microsecond=0)
        all_items: list[Announcement] = []
        fetched_pages: list[int] = []
        error_pages: list[str] = []
        reached_date_boundary = False

        # First, fetch page 1 to discover total page count
        html = self._get_text_with_retry(f"{base}/index.html")
        fetched_pages.append(1)
        parser = BeijingListParser()
        parser.feed(html)
        reached_date_boundary = self._collect_beijing_items(parser.items, now, all_items, target_start, target_end)

        # Extract total pages from "1/53页"
        total_pages = 1
        m = re.search(r'/(\d+)\s*页', html)
        if m:
            total_pages = min(int(m.group(1)), self._bj_max_pages)
        expected_total_pages = total_pages

        # Fetch remaining pages
        for page in range(2, total_pages + 1):
            if reached_date_boundary:
                break
            url = f"{base}/index_{page}.html"
            try:
                html = self._get_text_with_retry(url, referer=f"{base}/index.html")
                fetched_pages.append(page)
                parser = BeijingListParser()
                parser.feed(html)
                if self._collect_beijing_items(parser.items, now, all_items, target_start, target_end):
                    reached_date_boundary = True
            except Exception as exc:
                error_pages.append(f"{page}: {type(exc).__name__}: {exc}")

        hit_page_cap = bool(total_pages >= self._bj_max_pages and not reached_date_boundary)
        status = self._completeness_status(error_pages, hit_page_cap)
        self._last_crawl_audit = self._build_crawl_audit(
            source_key=getattr(self, "_current_source_key", "beijing_gcjs_zbgg"),
            source_name=getattr(self, "_current_source_name", "北京市公共资源交易服务平台"),
            crawl_date=target_start.strftime("%Y-%m-%d"),
            target_start=target_start,
            target_end=target_end,
            expected_total_count=None,
            expected_total_pages=expected_total_pages,
            fetched_pages=fetched_pages,
            items=all_items,
            reached_date_boundary=reached_date_boundary,
            hit_page_cap=hit_page_cap,
            error_pages=error_pages,
            completeness_status=status,
            started_at=started_at,
        )

        return all_items

    def _collect_beijing_items(
        self,
        raw_items: list[dict[str, str]],
        now: datetime,
        out: list[Announcement],
        target_start: datetime | None = None,
        target_end: datetime | None = None,
    ) -> bool:
        reached_boundary = False
        for raw in raw_items:
            published_at = self._parse_publish_datetime(raw.get("publish_time", ""))
            if target_start and published_at and published_at < target_start:
                reached_boundary = True
                continue
            if target_end and published_at and published_at > target_end:
                continue
            if "招标公告" not in raw["title"]:
                continue
            if any(kw in raw["title"] for kw in ["资格预审", "更正", "废标", "流标", "终止"]):
                continue
            region = ""
            m = re.match(r"【([^】]+)】", raw["title"])
            if m:
                region = m.group(1)
            out.append(Announcement(
                source_name=getattr(self, "_current_source_name", "北京市公共资源交易服务平台"),
                source_key=getattr(self, "_current_source_key", "beijing_gcjs_zbgg"),
                title=raw["title"],
                url=raw["url"],
                publish_time=raw["publish_time"],
                notice_type="招标公告",
                notice_sub_type="招标公告",
                region=region,
                raw=raw,
                first_seen_at=now,
            ))
        return reached_boundary

    def fetch_beijing_detail(self, announcement: Announcement) -> Announcement | None:
        """Scrape Beijing detail page HTML for full content and structured fields."""
        try:
            html = self.client.get_text(announcement.url, referer="https://ggzyfw.beijing.gov.cn/jyxxggjtbyqs/index.html")
        except Exception:
            return None

        # Extract newsCon content block — ends at fixed_box or lconbot
        idx = html.find('<div class="newsCon"')
        if idx < 0:
            return None
        tail = html[idx:]
        end_idx = -1
        for marker in ['fixed_box', 'lconbot']:
            ei = tail.find(marker)
            if ei > 0:
                end_idx = ei
                break
        if end_idx < 0:
            content_block = tail[:8000]  # fallback
        else:
            content_block = tail[:end_idx]
        content_block = re.sub(r'(</div>\s*)+$', '', content_block)

        # Extract fields: values are in <u> tags after key labels
        # e.g. 招标人为<u>&nbsp;&nbsp;中航(北京)科技产业服务有限公司&nbsp;&nbsp;</u>
        raw_text = re.sub(r'<[^>]+>', ' ', content_block)
        raw_text = re.sub(r'\s+', ' ', raw_text).strip()

        def _pick(label: str, html: str) -> str:
            # Pattern: KEY_LABEL + (为|:：) + optional whitespace/tags + <u>VALUE</u>
            m = re.search(re.escape(label) + r'\s*(?:为|[:：])?\s*<u>(.*?)</u>', html, re.I | re.DOTALL)
            if m:
                v = re.sub(r'<[^>]+>', '', m.group(1))
                v = re.sub(r'&nbsp;', ' ', v)
                v = re.sub(r'\s+', ' ', v).strip()
                return v
            # Fallback: KEY_LABEL + text until next keyword/break
            m2 = re.search(re.escape(label) + r'\s*(?:为|[:：])?\s*(.{2,80}?)(?:\s*(?:。</|；<|</div>|<br))', html, re.I)
            if m2:
                v = re.sub(r'<[^>]+>', '', m2.group(1))
                v = re.sub(r'&nbsp;', ' ', v)
                return re.sub(r'\s+', ' ', v).strip()
            return ""

        tenderer = _pick("招标人为", content_block) or _pick("招标人", content_block) or _pick("项目建设单位", content_block)
        project_name = _pick("本招标项目", content_block) or _pick("招标项目名称", content_block)
        bid_deadline = _pick("获取截止时间", content_block) or _pick("递交截止时间", content_block)
        engineering_type = _pick("招标内容", content_block)
        bid_method = _pick("招标方式", content_block)
        region_name = _pick("建设地点", content_block)

        merged_tenderer = announcement.tenderer or tenderer
        merged_project_name = announcement.project_name or project_name
        merged_bid_deadline = announcement.bid_deadline or bid_deadline
        merged_engineering_type = announcement.engineering_type or engineering_type
        merged_bid_method = announcement.bid_method or bid_method
        merged_region = announcement.region or region_name

        attrs = {"tenderer": tenderer, "project_name": project_name, "bid_deadline": bid_deadline,
                 "engineering_type": engineering_type, "bid_method": bid_method, "region": region_name}

        update_announcement_detail(
            ann_id=announcement.id or 0,
            detail_content=content_block,
            detail_attrs=attrs,
            bid_deadline=merged_bid_deadline,
            project_name=merged_project_name,
            tenderer=merged_tenderer,
            engineering_type=merged_engineering_type,
            bid_method=merged_bid_method,
        )

        return announcement.model_copy(update={
            "detail_content": content_block,
            "detail_fetched": True,
            "bid_deadline": merged_bid_deadline,
            "project_name": merged_project_name,
            "tenderer": merged_tenderer,
            "engineering_type": merged_engineering_type,
            "bid_method": merged_bid_method,
            "region": merged_region,
        })

    # ─── Batch detail fetching (routes to correct handler) ──

    def _fetch_details_batch(self, items: list[Announcement]) -> int:
        count = 0
        for item in items:
            if not item.id:
                continue
            if self._is_beijing_announcement(item):
                result = self.fetch_beijing_detail(item)
            else:
                result = self.fetch_shenzhen_detail(item)
            if result:
                count += 1
        return count

    def fetch_detail_for_announcement(self, announcement: Announcement) -> Announcement | None:
        """Public method: fetch detail for any announcement by source type."""
        if self._is_beijing_announcement(announcement):
            return self.fetch_beijing_detail(announcement)
        else:
            return self.fetch_shenzhen_detail(announcement)

    def _is_beijing_announcement(self, announcement: Announcement) -> bool:
        return announcement.source_key == "beijing_gcjs_zbgg" or "ggzyfw.beijing.gov.cn" in announcement.url

    # ─── Utility ──────────────────────────────────────────

    def _repair_mojibake(self, value: Any) -> str:
        text = "" if value is None else str(value)
        if not text:
            return text
        try:
            return text.encode("latin1").decode("utf-8")
        except Exception:
            return text

    def _parse_publish_datetime(self, value: str) -> datetime | None:
        if not value:
            return None
        text = value.replace("T", " ").strip()
        for fmt, size in (("%Y-%m-%d %H:%M:%S", 19), ("%Y-%m-%d %H:%M", 16), ("%Y-%m-%d", 10)):
            try:
                return datetime.strptime(text[:size], fmt)
            except ValueError:
                continue
        return None

    def _post_json_with_retry(self, url: str, payload: dict[str, Any], referer: str | None = None, attempts: int = 3) -> dict[str, Any]:
        last_exc: Exception | None = None
        for attempt in range(attempts):
            try:
                return self.client.post_json(url, payload, referer=referer)
            except Exception as exc:
                last_exc = exc
                if attempt < attempts - 1:
                    time.sleep(1 + attempt)
        if last_exc:
            raise last_exc
        raise RuntimeError("post_json retry failed")

    def _get_text_with_retry(self, url: str, referer: str | None = None, attempts: int = 3) -> str:
        last_exc: Exception | None = None
        for attempt in range(attempts):
            try:
                return self.client.get_text(url, referer=referer)
            except Exception as exc:
                last_exc = exc
                if attempt < attempts - 1:
                    time.sleep(1 + attempt)
        if last_exc:
            raise last_exc
        raise RuntimeError("get_text retry failed")

    def _completeness_status(self, error_pages: list[str], hit_page_cap: bool) -> str:
        if error_pages:
            return "partial"
        if hit_page_cap:
            return "partial"
        return "complete"

    def _build_crawl_audit(
        self,
        source_key: str,
        source_name: str,
        crawl_date: str,
        target_start: datetime,
        target_end: datetime,
        expected_total_count: int | None,
        expected_total_pages: int | None,
        fetched_pages: list[int],
        items: list[Announcement],
        reached_date_boundary: bool,
        hit_page_cap: bool,
        error_pages: list[str],
        completeness_status: str,
        started_at: datetime,
    ) -> SourceCrawlRun:
        publish_times = [item.publish_time for item in items if item.publish_time]
        sorted_times = sorted(publish_times)
        return SourceCrawlRun(
            source_key=source_key,
            source_name=source_name,
            crawl_date=crawl_date,
            target_start_time=target_start.isoformat(timespec="seconds"),
            target_end_time=target_end.isoformat(timespec="seconds"),
            expected_total_count=expected_total_count,
            expected_total_pages=expected_total_pages,
            fetched_pages=fetched_pages,
            fetched_count=len(items),
            first_publish_time=sorted_times[-1] if sorted_times else "",
            last_publish_time=sorted_times[0] if sorted_times else "",
            reached_date_boundary=reached_date_boundary,
            hit_page_cap=hit_page_cap,
            error_pages=error_pages,
            completeness_status=completeness_status,
            started_at=started_at,
            finished_at=datetime.now(),
            message=", ".join(error_pages)[:1000],
        )
