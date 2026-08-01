// DOM elements
const crawlButton = document.querySelector("#crawlButton");
const crawlStatus = document.querySelector("#crawlStatus");
const searchInput = document.querySelector("#searchInput");
const searchButton = document.querySelector("#searchButton");
const clearSearchButton = document.querySelector("#clearSearchButton");
const announcementList = document.querySelector("#announcementList");
const listTitle = document.querySelector("#listTitle");
const listCount = document.querySelector("#listCount");
const statTotal = document.querySelector("#statTotal");
const statDetail = document.querySelector("#statDetail");
const statDeadline = document.querySelector("#statDeadline");
const detailModal = document.querySelector("#detailModal");
const detailTitle = document.querySelector("#detailTitle");
const detailMeta = document.querySelector("#detailMeta");
const detailContent = document.querySelector("#detailContent");
const detailClose = document.querySelector("#detailClose");
const detailOriginalLink = document.querySelector("#detailOriginalLink");

let currentSearch = "";
let currentItems = [];

// ====================================================================
// Init
// ====================================================================
async function init() {
  await loadAnnouncements();
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") search();
  });
  searchButton.addEventListener("click", search);
  clearSearchButton.addEventListener("click", clearSearch);
  crawlButton.addEventListener("click", doCrawl);
  detailClose.addEventListener("click", () => detailModal.close());
  detailModal.addEventListener("click", (e) => {
    if (e.target === detailModal) detailModal.close();
  });
}

// ====================================================================
// API helpers
// ====================================================================
async function api(url, opts = {}) {
  const response = await fetch(url, opts);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function loadAnnouncements() {
  try {
    const params = new URLSearchParams({ limit: 100, offset: 0 });
    if (currentSearch) params.set("search", currentSearch);
    const data = await api(`/api/announcements?${params}`);
    currentItems = data.items;
    renderAnnouncements(data.items);
    updateStats(data);
    listTitle.textContent = currentSearch ? `搜索结果` : "招标公告列表";
    listCount.textContent = currentSearch
      ? `找到 ${data.total} 条匹配`
      : `共 ${data.total} 条`;
  } catch (e) {
    announcementList.innerHTML = `<p class="placeholder">加载失败：${escapeHtml(e.message)}</p>`;
  }
}

async function doCrawl() {
  crawlButton.disabled = true;
  showStatus("正在抓取深圳建设工程招标公告…", "info");
  try {
    const result = await api("/api/announcements/crawl", { method: "POST" });
    const msgs = result.messages.join("；");
    showStatus(
      `抓取完成：列表 ${result.fetched_count} 条，新增 ${result.inserted_count} 条，详情 ${result.detail_fetched_count || 0} 条。${msgs}`,
      "success"
    );
    await loadAnnouncements();
  } catch (e) {
    showStatus(`抓取失败：${escapeHtml(e.message)}`, "error");
  } finally {
    crawlButton.disabled = false;
  }
}

function showStatus(msg, type) {
  crawlStatus.style.display = "block";
  crawlStatus.textContent = msg;
  crawlStatus.className = `crawl-status ${type}`;
}

// ====================================================================
// Render Announcements
// ====================================================================
function renderAnnouncements(items) {
  if (!items.length) {
    announcementList.innerHTML = `<p class="placeholder">${currentSearch ? "没有匹配的公告" : "点击右上角「抓取最新公告」开始采集数据"}</p>`;
    return;
  }

  announcementList.innerHTML = items.map((item, i) => renderCard(item, i)).join("");

  // Attach event listeners
  items.forEach((item, i) => {
    const card = document.querySelector(`#card-${i}`);
    if (!card) return;
    card.querySelector(".ann-card-title").addEventListener("click", (e) => {
      e.stopPropagation();
      showDetail(item);
    });
    card.querySelector(".ann-card-expand-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleExpand(i, item);
    });
  });
}

function renderCard(item, index) {
  const deadline = item.bid_deadline ? parseDeadline(item.bid_deadline) : null;
  const deadlineClass = deadlineClassify(deadline);
  const deadlineText = item.bid_deadline
    ? formatDate(item.bid_deadline)
    : "—";

  const tags = [];
  if (item.notice_sub_type) tags.push(`<span class="ann-tag type">${escapeHtml(item.notice_sub_type)}</span>`);
  if (item.engineering_type) tags.push(`<span class="ann-tag type">${escapeHtml(item.engineering_type)}</span>`);
  if (item.region) tags.push(`<span class="ann-tag region">${escapeHtml(item.region)}</span>`);

  return `
    <article class="ann-card" id="card-${index}">
      <div class="ann-card-main">
        <a class="ann-card-title" href="javascript:void(0)">${escapeHtml(item.title)}</a>
        <div class="ann-card-fields">
          ${item.project_name ? `<span class="ann-card-field">项目：<strong>${escapeHtml(item.project_name)}</strong></span>` : ""}
          ${item.bid_section_name ? `<span class="ann-card-field">标段：<strong>${escapeHtml(item.bid_section_name)}</strong></span>` : ""}
          ${item.tenderer ? `<span class="ann-card-field">招标人：<strong>${escapeHtml(item.tenderer)}</strong></span>` : ""}
          <span class="ann-card-field">发布：<strong>${escapeHtml(item.publish_time)}</strong></span>
        </div>
        <div class="ann-card-right">
          <span class="ann-card-deadline ${deadlineClass}">截标：${deadlineText}</span>
          <div class="ann-card-tags">${tags.join("")}</div>
          <a class="ann-card-expand-btn" href="javascript:void(0)" style="font-size:12px;color:var(--muted)">
            ${item.detail_fetched ? "📋 查看详情" : "📋 加载详情"}
          </a>
        </div>
        <div class="ann-card-expand">
          <div class="detail-expand-content" id="expand-${index}">
            ${item.detail_fetched ? "" : `<p style="color:var(--muted);font-size:13px">详情尚未抓取，点击「加载详情」获取完整公告内容</p>`}
          </div>
        </div>
      </div>
    </article>
  `;
}

// ====================================================================
// Expand card to show detail
// ====================================================================
async function toggleExpand(index, item) {
  const card = document.querySelector(`#card-${index}`);
  if (!card) return;

  const wasExpanded = card.classList.contains("expanded");
  if (wasExpanded) {
    card.classList.remove("expanded");
    return;
  }

  card.classList.add("expanded");
  const expandEl = document.querySelector(`#expand-${index}`);
  if (!expandEl) return;

  if (!item.detail_fetched) {
    expandEl.innerHTML = `<p style="color:var(--muted);font-size:13px">正在抓取详情…</p>`;
    try {
      const updated = await api(`/api/announcements/${item.id}`);
      item.detail_fetched = updated.detail_fetched;
      item.detail_content = updated.detail_content;
      item.bid_deadline = updated.bid_deadline || item.bid_deadline;
      item.project_name = updated.project_name || item.project_name;
      item.tenderer = updated.tenderer || item.tenderer;
    } catch (e) {
      expandEl.innerHTML = `<p style="color:var(--danger);font-size:13px">详情抓取失败：${escapeHtml(e.message)}</p>`;
      return;
    }
  }

  if (item.detail_content) {
    expandEl.innerHTML = `<iframe class="detail-iframe" srcdoc="${escapeAttribute(item.detail_content)}" sandbox="allow-scripts"></iframe>`;
  } else {
    expandEl.innerHTML = `<p style="color:var(--muted)">暂无详情内容</p>`;
  }
}

// ====================================================================
// Detail Modal
// ====================================================================
async function showDetail(item) {
  detailTitle.textContent = item.title;
  detailContent.innerHTML = `<p style="color:var(--muted);padding:20px;text-align:center">加载中…</p>`;
  detailMeta.innerHTML = renderMeta(item);
  detailOriginalLink.href = item.url;
  detailModal.showModal();

  // Fetch latest detail if not already fetched
  let detail = item;
  if (!item.detail_fetched) {
    try {
      detail = await api(`/api/announcements/${item.id}`);
      item.detail_fetched = true;
      item.detail_content = detail.detail_content;
    } catch (e) {
      detailContent.innerHTML = `<p style="color:var(--danger);text-align:center;padding:20px">详情加载失败</p>`;
      detailMeta.innerHTML = renderMeta(item);
      return;
    }
  }

  detailMeta.innerHTML = renderMeta(detail);

  if (detail.detail_content) {
    detailContent.innerHTML = `<iframe style="width:100%;min-height:500px;border:0" srcdoc="${escapeAttribute(detail.detail_content)}" sandbox="allow-scripts"></iframe>`;
  } else {
    detailContent.innerHTML = `<p style="color:var(--muted);text-align:center;padding:40px">暂无详情内容，可点击原文链接查看</p>`;
  }
}

function renderMeta(item) {
  const parts = [];
  if (item.project_name) parts.push(`项目：<strong>${escapeHtml(item.project_name)}</strong>`);
  if (item.bid_section_name) parts.push(`标段：<strong>${escapeHtml(item.bid_section_name)}</strong>`);
  if (item.tenderer) parts.push(`招标人：<strong>${escapeHtml(item.tenderer)}</strong>`);
  if (item.project_code) parts.push(`编号：<strong>${escapeHtml(item.project_code)}</strong>`);
  if (item.bid_deadline) parts.push(`截标：<strong>${escapeHtml(item.bid_deadline)}</strong>`);
  if (item.engineering_type) parts.push(`类型：<strong>${escapeHtml(item.engineering_type)}</strong>`);
  if (item.region) parts.push(`区域：<strong>${escapeHtml(item.region)}</strong>`);
  parts.push(`发布时间：${escapeHtml(item.publish_time)}`);
  if (item.detail_fetched) {
    parts.push(`<span style="color:var(--accent)">✓ 已获取全文</span>`);
  }
  return parts.join("&nbsp;&nbsp;·&nbsp;&nbsp;");
}

// ====================================================================
// Stats
// ====================================================================
function updateStats(data) {
  const items = data.items || [];
  statTotal.textContent = data.total || items.length;

  const withDetail = items.filter((i) => i.detail_fetched).length;
  statDetail.textContent = withDetail;

  // Count items with deadline within 7 days
  const now = new Date();
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  let deadlineCount = 0;
  items.forEach((item) => {
    if (!item.bid_deadline) return;
    const d = parseDeadline(item.bid_deadline);
    if (d && d >= now && d <= sevenDays) deadlineCount++;
  });
  statDeadline.textContent = deadlineCount;
  if (deadlineCount > 3) statDeadline.className = "warn";
  else statDeadline.className = "";
}

// ====================================================================
// Search
// ====================================================================
function search() {
  currentSearch = searchInput.value.trim();
  if (currentSearch) {
    clearSearchButton.style.display = "";
  } else {
    clearSearchButton.style.display = "none";
  }
  loadAnnouncements();
}

function clearSearch() {
  searchInput.value = "";
  currentSearch = "";
  clearSearchButton.style.display = "none";
  loadAnnouncements();
}

// ====================================================================
// Utilities
// ====================================================================
function parseDeadline(str) {
  if (!str) return null;
  // Try common formats
  const d = new Date(str.replace(/\.\d+/, ""));  // Handle .000 etc
  if (!isNaN(d.getTime())) return d;
  // Try yyyy-MM-dd HH:mm:ss
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return null;
}

function deadlineClassify(d) {
  if (!d) return "empty";
  const now = new Date();
  const threeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (d <= now) return "urgent";  // Already past or today
  if (d <= threeDays) return "urgent";
  if (d <= sevenDays) return "soon";
  return "normal";
}

function formatDate(str) {
  if (!str) return "—";
  const d = parseDeadline(str);
  if (!d) return str.substring(0, 16);
  const now = new Date();
  const diffDays = Math.ceil((d - now) / (24 * 60 * 60 * 1000));
  const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  if (diffDays <= 0) return `${dateStr} (今日)`;
  if (diffDays === 1) return `${dateStr} (明天)`;
  if (diffDays <= 3) return `${dateStr} (${diffDays}天后)`;
  if (diffDays <= 7) return `${dateStr} (${diffDays}天后)`;
  return dateStr;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

// ====================================================================
// Start
// ====================================================================
init().catch((e) => {
  announcementList.innerHTML = `<p class="placeholder">初始化失败：${escapeHtml(e.message)}</p>`;
});
