# 招标公告提醒与商机研判系统 PRD

## 1. 背景

项目面向工程咨询、造价咨询、项目管理、招标代理、监理、设计咨询等业务团队，自动聚合公开招标公告，抓取公告详情，并通过规则引擎与大模型 Agent 对公告进行商机研判、打标和跟进建议输出。

当前系统已经具备公告列表抓取、详情抓取、SQLite 存储、前端列表展示和基础 Agent 分析能力。本轮重设计目标是把系统从“能跑的采集 MVP”升级为“可持续运转的公告商机雷达”。

## 2. 产品目标

1. 每天低频抓取已配置公告源，沉淀公告列表与详情。
2. 对新增或待处理公告执行二阶段研判：
   - 第一阶段：规则初筛，快速识别明显相关、明显不相关和待精判公告。
   - 第二阶段：LLM 精细分析，对待精判或高价值公告输出结构化标签、评分、行动建议。
3. 支持历史公告补抓详情、补跑 Agent、强制重跑 Agent。
4. 前端清晰展示公告状态、详情状态、Agent 状态、关注评分和建议动作。
5. 对每次抓取任务记录开始余额、结束余额和差值费用，形成费用统计。
6. 系统遵循公开页面、低频访问、遇限制暂停的合规边界。

## 3. 用户角色

- 业务负责人：查看高分商机、跟进建议和截止时间。
- 招投标专员：检索公告、查看详情、确认是否纳入跟进池。
- 系统管理员：维护公告源、配置 Agent API、检查采集状态。

## 4. 业务范围

### 4.1 重点关注

- 全过程工程咨询
- 工程造价咨询
- 项目管理
- 招标代理
- 工程监理
- 设计咨询、勘察设计
- EPC、设计施工总承包，尤其是可通过联合体参与的项目
- BIM 咨询、深化设计、代建、项目管理服务

### 4.2 默认低优先级或不推荐

- 纯施工总承包，且不含设计、咨询、管理、造价、BIM、联合体机会
- 设备采购、材料采购、甲供物资
- 更正公告、流标公告、废标公告、资格预审结果类信息

## 5. 核心流程

### 5.1 每日自动流程

1. 到达配置时间后读取启用的数据源。
2. 逐个源低频抓取公告列表。
3. 新公告入库，重复公告跳过。
4. 对新增公告批量抓取详情。
5. 对已抓详情但未分析的公告运行 Agent。
6. 写入评分、标签、建议动作和分析状态。

### 5.2 手动补跑流程

1. 用户点击“补跑 Agent”。
2. 后端先补抓一批缺失详情的公告。
3. 后端再运行 Agent 分析队列。
4. 前端刷新列表和状态。

### 5.3 公告详情查看流程

1. 用户点击公告。
2. 若详情未抓取，后端即时抓取详情。
3. 前端展示原公告详情 HTML。
4. 该公告进入待 Agent 分析队列。

## 6. Agent 设计

### 6.1 二阶段架构

#### 阶段一：规则初筛

输入：
- 标题
- 工程类型
- 项目名称
- 标段名称
- 招标人
- 公告详情前若干字符

输出：
- `score`: 0-5
- `summary`: 初筛说明
- `tags`: 规则标签
- `action`: 初步建议
- `needs_llm`: 是否需要 LLM 精判

规则：
- 出现“全过程工程咨询、造价咨询、项目管理、招标代理、工程咨询”等，初筛 5 分。
- 出现“EPC、设计施工总承包、代建、BIM、深化设计、含设计”等，初筛 4 分。
- 出现“设计、勘察设计、方案设计、初步设计、施工图设计”等，初筛 3 分。
- 出现“设备采购、材料采购、甲供物资、流标、废标、更正”等，初筛 1 分。
- 纯施工且无咨询/设计/管理信号，交给 LLM 或低分兜底。

#### 阶段二：LLM 精细分析

触发条件：
- `needs_llm = true`
- 或规则初筛分数大于等于 3，需要更细标签和行动建议
- 或用户强制重跑

LLM 任务：
- 阅读完整公告详情。
- 判断是否与目标业务相关。
- 输出评分、置信度、标签、关键资质要求、建议动作、判断依据。

LLM 必须返回 JSON：

```json
{
  "opportunity_score": 1,
  "relevant": false,
  "confidence": 0.85,
  "analysis": "一句话说明判断依据",
  "tags": ["施工", "不推荐"],
  "suggested_action": "不推荐",
  "key_requirements": "无明显咨询类资质要求",
  "risk_flags": ["纯施工"]
}
```

评分定义：

- 5 分：直接匹配主营业务，可重点跟进。
- 4 分：高度相关，可能需要联合体或补充判断。
- 3 分：可关注，有一定咨询、设计、管理或延伸机会。
- 2 分：弱相关，仅保留观察。
- 1 分：不相关或不推荐。
- 0 分：未分析或分析失败。

### 6.2 Agent 状态

公告需要记录：

- `agent_analyzed`: 是否已有可展示分析结果。
- `agent_stage`: `none`、`rule`、`llm`、`fallback`、`failed`。
- `agent_confidence`: 0-1。
- `agent_error`: 最近一次分析错误。
- `agent_updated_at`: 最近分析时间。

### 6.3 失败策略

- 未配置 API key 或关闭 Agent：不调用 LLM，只允许规则结果作为 `rule` 或 `fallback`。
- LLM 调用失败：记录错误；如果已有规则结果，可保存为 `fallback`，但要保留可重跑能力。
- JSON 解析失败：尝试抽取 JSON 对象；仍失败则记录错误。

## 7. 数据模型

### 7.1 announcements

核心字段：

- `id`
- `source_name`
- `source_key`
- `title`
- `url`
- `publish_time`
- `notice_type`
- `notice_sub_type`
- `region`
- `project_name`
- `project_code`
- `bid_section_name`
- `tenderer`
- `bid_deadline`
- `engineering_type`
- `bid_method`
- `detail_content`
- `detail_fetched`
- `opportunity_score`
- `agent_summary`
- `agent_tags`
- `agent_action`
- `agent_analyzed`
- `agent_stage`
- `agent_confidence`
- `agent_error`
- `agent_updated_at`
- `raw_json`
- `first_seen_at`

### 7.2 source_configs

- `id`
- `source_key`
- `name`
- `list_url`
- `source_type`: `shenzhen`、`beijing`
- `enabled`
- `created_at`

说明：当前只内置深圳 JSON API 和北京 HTML 两类解析器。新增数据源必须选择已有解析器类型；后续若接入新站点，需要新增解析器。

### 7.3 app_settings

Agent 配置键：

- `agent_api_key`
- `agent_api_base`
- `agent_model`
- `agent_enabled`

### 7.4 billing_runs

- `id`
- `job_type`: `crawl`
- `started_at`
- `finished_at`
- `start_balance`
- `end_balance`
- `cost`
- `currency`
- `provider`
- `status`
- `error`

## 8. API 设计

所有接口以 `/api` 为前缀。

### 8.1 公告列表

`GET /api/announcements`

Query：

- `limit`: 默认 500，范围 1-1000
- `offset`: 默认 0
- `search`: 标题、项目名、招标人、标段名搜索
- `source_key`: 数据源过滤
- `days`: 近 N 天，0 表示不限
- `exclude_engineering`: 逗号分隔的工程类型排除项
- `engineering`: 逗号分隔的工程类型包含项
- `sort_by`: `publish_time` 或 `bid_deadline`
- `sort_order`: `desc` 或 `asc`

Response：

```json
{
  "items": [],
  "total": 100,
  "limit": 500,
  "offset": 0
}
```

### 8.2 公告详情

`GET /api/announcements/{ann_id}`

行为：
- 若详情已抓取，直接返回。
- 若详情未抓取，按来源类型即时抓取并更新数据库。

Response：`Announcement`

### 8.3 抓取公告列表

`POST /api/announcements/crawl`

行为：
- 抓取所有启用数据源。
- 新公告入库。
- 对新公告抓详情。
- 对待分析公告运行 Agent。

Response：

```json
{
  "source_count": 2,
  "fetched_count": 100,
  "inserted_count": 20,
  "skipped_count": 80,
  "blocked_count": 0,
  "detail_fetched_count": 20,
  "messages": [],
  "announcements": []
}
```

### 8.4 补抓详情

`POST /api/announcements/crawl-detail?limit=30`

行为：
- 抓取一批 `detail_fetched = 0` 的公告详情。
- 不调用 Agent。

Response：

```json
{
  "fetched": 10,
  "message": "fetched detail for 10/30"
}
```

### 8.5 运行 Agent

`POST /api/agent/analyze`

Query：

- `limit`: 默认 50，范围 1-100
- `fetch_details`: 默认 `false`。为 `true` 时先补抓详情。
- `force`: 默认 `false`。为 `true` 时允许重跑已分析公告。

行为：
- 读取已抓详情且待分析的公告。
- 执行规则初筛。
- 按条件调用 LLM 精判。
- 保存分析结果。

Response：

```json
{
  "analyzed": 5,
  "detail_fetched": 10,
  "results": [
    {
      "id": 1,
      "score": 5,
      "stage": "llm",
      "summary": "直接契合全过程工程咨询"
    }
  ],
  "message": "analyzed 5 announcements"
}
```

### 8.6 Agent 配置

`GET /api/agent/settings`

Response：

```json
{
  "api_base": "https://api.deepseek.com/v1",
  "model": "deepseek-chat",
  "api_key_masked": "sk-abc...xyz",
  "enabled": true
}
```

`PUT /api/agent/settings`

Request：

```json
{
  "api_base": "https://api.deepseek.com/v1",
  "model": "deepseek-chat",
  "api_key": "__KEEP__",
  "enabled": true
}
```

说明：
- `api_key = "__KEEP__"` 表示保留原密钥。
- `enabled = false` 表示保留密钥但暂停 LLM 调用。

### 8.7 商机列表

`GET /api/opportunities`

Query：

- `days`: 默认 15，范围 1-60
- `min_score`: 默认 3，范围 1-5

Response：

```json
{
  "items": [],
  "total": 10,
  "days": 15,
  "min_score": 3
}
```

### 8.8 数据源配置

`GET /api/sources/configs`

`POST /api/sources/configs`

`PUT /api/sources/configs/{source_key}`

`DELETE /api/sources/configs/{source_key}`

SourceConfig：

```json
{
  "id": 1,
  "source_key": "shenzhen_jsgc_zbgg",
  "name": "深圳公共资源交易中心",
  "list_url": "https://www.szggzy.com/jygg/list.html?id=jsgc",
  "source_type": "shenzhen",
  "enabled": true,
  "created_at": "2026-06-15T08:00:00"
}
```

### 8.9 数据源状态

`GET /api/sources/states`

Response：

```json
[
  {
    "source_key": "shenzhen_jsgc_zbgg",
    "source_name": "深圳公共资源交易中心",
    "consecutive_failures": 0,
    "is_paused": false,
    "last_error": "",
    "updated_at": "2026-06-15T08:00:00"
  }
]
```

### 8.10 费用统计

`GET /api/billing/summary`

Response：

```json
{
  "total_cost": 1.25,
  "run_count": 3,
  "currency": "CNY",
  "last_run": {
    "id": 3,
    "job_type": "crawl",
    "started_at": "2026-06-15T20:00:00",
    "finished_at": "2026-06-15T20:05:00",
    "start_balance": 13.57,
    "end_balance": 13.42,
    "cost": 0.15,
    "currency": "CNY",
    "provider": "deepseek",
    "status": "finished",
    "error": ""
  }
}
```

`GET /api/billing/runs?limit=50`

返回最近费用流水。

余额计算规则：
- 抓取任务开始前调用供应商余额接口。
- 抓取和 Agent 分析完成后再次调用余额接口。
- `cost = max(0, start_balance - end_balance)`。
- 当前 DeepSeek 余额接口为 `GET /user/balance`。若供应商不支持余额接口，抓取任务仍继续执行，但费用流水会记录错误并显示费用不可用。

## 9. 前端需求

首页：

- 展示总数、已抓详情数、已研判数、重点商机数、临近截止数。
- 支持来源、时间、工程类型、搜索和排序筛选。
- 支持“立即抓取”和“补跑 Agent”。
- “补跑 Agent”应先补抓详情，再分析。
- 公告行展示详情状态、Agent 状态、评分、标签、建议动作。

配置页：

- 管理数据源。
- 配置 Agent API Base、模型、密钥。
- 支持保留密钥但关闭 Agent。

## 10. 合规与稳定性

- 只访问公开页面。
- 不登录、不破解验证码、不绕过访问限制。
- 遇到 401、403、407、418、429、451 或验证码/访问受限页面，记录失败并暂停对应来源。
- 抓取请求使用低频延迟。
- 每个来源连续失败达到阈值后暂停。

## 11. 验收标准

### 11.1 静态验收

- 后端 Python 编译通过。
- 前端 TypeScript 构建通过。
- README/PRD 与实际接口一致。

### 11.2 接口验收

- 服务可通过 `uvicorn app.main:app` 启动。
- `/api/agent/settings` 返回 200。
- `/api/announcements?limit=3` 返回 200。
- `/api/announcements/crawl-detail?limit=1` 可补抓详情。
- `/api/agent/analyze?limit=1&fetch_details=true` 可完成至少 1 条分析，或在无待处理数据时返回明确空队列信息。

### 11.3 Agent 效果验收

- 对含“全过程工程咨询/造价咨询/项目管理”的公告，评分应倾向 5 或 4。
- 对 EPC/设计施工总承包公告，评分应倾向 4 或 3，并提示联合体或进一步确认。
- 对纯施工公告，评分应倾向 1 或 2。
- LLM 返回结果必须保存到公告表，并在前端展示。

## 12. 本期不做

- 不做验证码识别。
- 不做登录态采集。
- 不做邮件/微信/短信推送。
- 不做复杂权限系统。
- 不做任意站点通用爬虫配置器。
