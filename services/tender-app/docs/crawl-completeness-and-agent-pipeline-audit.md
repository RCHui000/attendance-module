# 招标公告抓取完整性与规则/Agent 分层审计报告

审计日期：2026-06-16
仓库：`RCHui000/tender-monitor`

## 1. 审计背景

本项目的目标不是简单展示各地公共资源交易网站上的原始公告，而是：

1. 聚合不同地方政府网站发布的公告；
2. 先确认每日抓取的数据是完整的；
3. 在完整数据基础上执行代码规则初筛；
4. 再由 Agent 对全量或尽可能全量公告进行精细研判和兜底；
5. 最终向管理层展示经过分析后的有效商机信息。

本次审计重点关注：

- 当前爬虫是否能够证明“当日公告已完整抓取”；
- 分页逻辑是否可能漏页、截断或静默失败；
- 当前代码是否在抓取阶段过早过滤公告；
- 规则初筛和 Agent 精筛是否符合“规则可解释、Agent 全量兜底”的产品设想；
- 前端展示是否应该围绕 Agent / 规则 / 全量三个视角重构。

## 2. 总体结论

当前系统可以抓到一批公告并入库，但还不能证明每日每个数据源的公告已经完整抓取。

当前最核心的风险是：

> 如果抓取数据本身不完整，后续规则筛选和 Agent 精筛再准确，也只能是在不完整样本上做判断。

因此，下一阶段优先级应为：

1. 建立“每日来源抓取批次”与“完整性证明”机制；
2. 修正分页停止条件，避免达到页数上限或单页失败时仍被视为成功；
3. 将抓取阶段过滤下沉到规则层，尽可能保留原始公告池；
4. 拆分规则结果和 Agent 结果，避免二者混在同一套字段里；
5. 前端改为 `Agent 精筛 / 规则初筛 / 全量公告` 三个视图。

## 3. 现有抓取流程

当前 `AnnouncementCrawler.crawl_all()` 的流程大致为：

1. 读取启用的数据源配置；
2. 按 `source_type` 分别调用深圳或北京爬虫；
3. 将抓到的公告保存到 `announcements` 表；
4. 只对新增公告批量抓取详情；
5. 运行 Agent 分析待处理公告；
6. 返回 `CrawlSummary`。

这个流程适合“增量抓取 MVP”，但还不是一个“按日完整抓取并可审计”的生产级流程。

## 4. 深圳源完整性审计

### 4.1 当前实现

深圳源通过接口分页抓取：

- `_list_page_size = 50`
- `_list_max_pages = 20`
- 理论最多抓取 `50 × 20 = 1000` 条

当前 payload 中存在时间字段，但没有使用日期窗口：

- `releaseTimeBegin = None`
- `releaseTimeEnd = None`

当前停止条件包括：

- API `code != 200` 时停止；
- 当前页 rows 为空时停止；
- 当前页 rows 数量小于 page size 时停止；
- 当前页没有 30 天内数据时停止。

### 4.2 风险

| 风险 | 说明 |
| --- | --- |
| 没有当日日期窗口 | 当前不是抓“今天完整公告”，而是抓一批近期公告。 |
| 没有 total / totalPages 校验 | 无法确认 API 声明的总数与实际抓取数是否一致。 |
| 页数上限固定 | 如果短时间内公告数超过 1000 条，会被截断。 |
| 依赖默认排序 | 代码假设接口按发布时间倒序返回，但没有显式校验。 |
| 没有完整性状态 | 即使提前 break，也没有标记本次抓取 partial。 |

### 4.3 建议

深圳源应优先改成按日期窗口抓取：

- `releaseTimeBegin = 当日 00:00:00`
- `releaseTimeEnd = 当日 23:59:59`

然后执行：

1. 请求第一页；
2. 读取接口返回的总数或总页数；
3. 逐页抓取所有页面；
4. 每页失败必须重试；
5. 重试后仍失败，则本来源本日状态为 `partial`；
6. 实际抓取数量必须与接口声明数量对账；
7. 达到 `_list_max_pages` 但仍未抓完时，必须标记为 `partial/capped`，不能视为成功。

如果接口没有可靠 total，则必须通过发布时间边界判断：

- 一直翻页，直到当前页最早发布时间早于目标日期开始时间；
- 并记录 `reached_date_boundary = true`；
- 如果达到页数上限仍未触达日期边界，则标记为 `partial`。

## 5. 北京源完整性审计

### 5.1 当前实现

北京源先抓第一页，并通过正则解析总页数：

- 从页面中匹配类似 `1/53页`；
- 使用 `_bj_max_pages = 60` 作为安全上限；
- 然后抓取 `index_2.html` 到 `index_N.html`。

### 5.2 高风险问题

北京源目前存在一个严重风险：单页抓取失败会被静默吞掉。

当前逻辑是：

```python
try:
    html = self.client.get_text(url, referer=f"{base}/index.html")
    parser = BeijingListParser()
    parser.feed(html)
    self._collect_beijing_items(parser.items, now, all_items)
except Exception:
    pass
```

这意味着：

> 如果第 3 页失败，但第 1、2、4、5 页成功，系统仍会继续运行，并且不会记录第 3 页缺失。

这会导致非常隐蔽的数据漏抓。

### 5.3 其他风险

| 风险 | 说明 |
| --- | --- |
| 总页数超过 60 时会被截断 | `_bj_max_pages = 60` 是安全上限，但触发上限时没有标记不完整。 |
| 没有当日日期边界 | 当前是按站点总页数抓，不是按“今天”抓。 |
| 抓取阶段提前过滤 | 标题不含“招标公告”或含“更正/废标/流标/终止”的内容直接被丢弃。 |
| 没有失败页记录 | 前端和日志都无法知道哪些页失败。 |

### 5.4 建议

北京源应改为：

1. 从第一页开始逐页抓；
2. 每页解析公告发布时间；
3. 只要当前页仍包含目标日期内公告，就继续抓下一页；
4. 当某一页所有公告均早于目标日期开始时间，才认为触达日期边界；
5. 单页失败必须记录到 `error_pages`；
6. `error_pages` 非空时，本次来源抓取状态必须为 `partial`；
7. 达到 `_bj_max_pages` 仍未触达日期边界时，本次状态必须为 `partial/capped`。

最低限度也要把静默异常改成：

```python
except Exception as exc:
    error_pages.append({"page": page, "error": str(exc)})
    continue
```

并在抓取结束后：

```python
if error_pages:
    completeness_status = "partial"
```

## 6. 当前抓取阶段过滤不符合产品设想

产品设想是：

1. 先完整抓取当日公告；
2. 再用代码规则初筛；
3. 再交给 Agent 精筛和兜底。

但当前代码在抓取阶段已经过滤。

### 6.1 深圳源

深圳接口请求中已经限定公告类型为“招标公告”。解析时又检查：

```python
if notice_sub_type != "招标公告":
    return None
```

### 6.2 北京源

北京源当前只保留标题包含“招标公告”的记录，并直接排除：

- 资格预审；
- 更正；
- 废标；
- 流标；
- 终止。

### 6.3 风险

如果目标是“保留全量公告池，再通过规则和 Agent 判断是否有效”，那么抓取阶段提前丢弃数据会造成：

- 无法审计哪些公告被丢弃；
- Agent 无法兜底规则漏判；
- 无法判断站点当天是否完整抓取；
- 后续规则无法迭代，因为负样本没有入库。

### 6.4 建议

抓取阶段应尽量只做结构化解析，不做业务过滤。

建议改为：

- 所有公告先入库；
- 保存 `notice_type`、`notice_sub_type`、`raw_title`、`raw_json/html`；
- 规则层负责判断是否是有效招标公告；
- Agent 层负责对规则漏判进行兜底；
- 前端全量视图可以展示“被规则排除”的公告，而不是让它们在抓取阶段消失。

如果短期必须控制数据量，可以保留轻量源级过滤，但必须记录：

- 本页原始条数；
- 入库条数；
- 被过滤条数；
- 被过滤原因分布。

## 7. 数据模型缺口

当前 `announcements` 表记录单条公告，`source_states` 只记录来源连续失败和暂停状态。

现有模型无法回答这些问题：

- 某来源今天应该抓几页？
- 实际抓了几页？
- 哪几页失败？
- 是否达到页数上限？
- 是否触达日期边界？
- 今天这个来源是否完整？
- 本次抓取是否可以进入 Agent 精筛？

## 8. 建议新增每日抓取批次表

建议新增 `source_crawl_runs` 表：

```sql
CREATE TABLE source_crawl_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT NOT NULL,
    source_name TEXT NOT NULL,
    crawl_date TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,

    target_start_time TEXT NOT NULL,
    target_end_time TEXT NOT NULL,

    expected_total_count INTEGER,
    expected_total_pages INTEGER,
    fetched_pages INTEGER NOT NULL DEFAULT 0,
    fetched_count INTEGER NOT NULL DEFAULT 0,
    saved_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    filtered_count INTEGER NOT NULL DEFAULT 0,

    first_publish_time TEXT,
    last_publish_time TEXT,
    reached_date_boundary INTEGER NOT NULL DEFAULT 0,
    hit_page_cap INTEGER NOT NULL DEFAULT 0,

    status TEXT NOT NULL,
    completeness_status TEXT NOT NULL,
    error_pages_json TEXT NOT NULL DEFAULT '[]',
    error_message TEXT NOT NULL DEFAULT '',
    raw_metrics_json TEXT NOT NULL DEFAULT '{}',

    created_at TEXT NOT NULL
);
```

`completeness_status` 建议枚举：

- `complete`
- `partial`
- `unknown`
- `failed`

`status` 建议枚举：

- `running`
- `finished`
- `failed`

## 9. 完整性判定标准

一个来源某一天的抓取只有在满足以下条件时，才能标记为 `complete`：

1. 成功抓取第一页；
2. 知道总页数，或通过发布时间判断已经触达目标日期边界；
3. 所有需要抓取的页都成功；
4. 没有达到安全页数上限；
5. 没有单页失败；
6. 如果接口提供 total，则 `fetched_count` 与 expected total 可对账；
7. 保存数量、重复数量、过滤数量可以与抓取数量对账；
8. 本来源没有被暂停或 blocked。

只要任一条件不满足，就不应标记为 `complete`。

## 10. Agent 流程应等待完整性确认

当前 `crawl_all()` 是抓完列表后立刻保存、抓详情、跑 Agent。

建议改成四阶段：

1. `crawl_list_for_date`：按来源和日期完整抓列表；
2. `verify_completeness`：判断本来源本日是否完整；
3. `fetch_details_for_complete_runs`：只对完整批次优先抓详情；
4. `run_rule_and_agent_pipeline`：在完整数据基础上执行规则和 Agent。

对于 `partial` 数据，可以入库，但默认不进入管理层 Agent 精筛视图，应进入：

- 全量公告；
- 待复核；
- 数据不完整警示区。

## 11. 规则结果和 Agent 结果应拆分

当前 `opportunity_score`、`agent_summary`、`agent_tags`、`agent_action`、`agent_stage` 等字段混合承载规则、LLM 和 fallback 的结果。

这不利于表达：

- 规则认为低价值，但 Agent 认为高价值；
- 规则未命中，但 Agent 发现机会；
- 规则高分，但 Agent 降级；
- Agent 失败时是否可以临时使用规则结果。

建议拆分为：

```text
rule_score
rule_summary
rule_tags
rule_action
rule_matched_keywords
rule_confidence
rule_updated_at

agent_score
agent_summary
agent_tags
agent_action
agent_confidence
agent_key_requirements
agent_risk_flags
agent_updated_at
agent_error

final_score
final_action
final_source
```

其中：

- `rule_*` 永远保留代码规则初筛结果；
- `agent_*` 保存 Agent 精筛结果；
- `final_*` 用于最终展示；
- `final_source` 可取 `agent`、`rule`、`fallback`、`manual`。

## 12. 前端视图建议

前端建议明确改成三个 Tab：

```text
Agent 精筛 | 规则初筛 | 全量公告
```

### 12.1 Agent 精筛

默认给管理层看。

建议展示：

- Agent 分数；
- Agent 建议动作；
- 一句话摘要；
- 招标人；
- 来源地区；
- 截止时间；
- 置信度；
- 风险标签；
- 数据完整性状态。

### 12.2 规则初筛

给产品负责人、招投标专员和开发者看。

建议展示：

- 规则分数；
- 命中关键词；
- 规则摘要；
- 规则建议；
- Agent 是否同意；
- 是否存在规则/Agent 分歧。

### 12.3 全量公告

作为审计池。

建议展示：

- 所有抓到的公告；
- 是否已抓详情；
- 规则状态；
- Agent 状态；
- 数据来源批次是否完整；
- 是否因为 partial 批次需要复核。

## 13. 建议修复任务拆分

### P0：必须优先做

- [ ] 新增 `source_crawl_runs` 表，记录每日来源抓取批次。
- [ ] 深圳源改为按日期窗口抓取，并记录 expected total / total pages。
- [ ] 北京源禁止吞掉单页异常，记录 `error_pages`。
- [ ] 达到 `_list_max_pages` 或 `_bj_max_pages` 时标记 `partial/capped`。
- [ ] 增加 `completeness_status`，并在 API 中返回。
- [ ] Agent 默认只消费 `complete` 批次的数据；`partial` 数据进入待复核。

### P1：尽快做

- [ ] 抓取阶段减少业务过滤，将过滤下沉到规则层。
- [ ] 保存被过滤条数和过滤原因。
- [ ] 拆分 `rule_*` 与 `agent_*` 字段。
- [ ] 前端 Tab 改为 `Agent 精筛 / 规则初筛 / 全量公告`。
- [ ] 前端增加“今日数据完整性”状态展示。

### P2：后续增强

- [ ] 增加每日抓取报告页面。
- [ ] 支持按来源查看缺页、失败页和分页对账。
- [ ] 增加规则/Agent 分歧视图。
- [ ] 支持人工标记误判，用于后续优化规则和 Agent prompt。

## 14. 验收标准

实现后，系统至少应能回答以下问题：

1. 今天每个数据源是否完整抓取？
2. 每个来源今天应抓几页、实际抓几页？
3. 是否有失败页？失败页是哪几页？
4. 是否因为达到页数上限而可能截断？
5. 今天抓取的第一条和最后一条公告发布时间分别是什么？
6. 今天有多少公告入库、多少重复、多少被规则排除？
7. Agent 精筛结果是否只基于完整批次？
8. 如果数据不完整，前端是否明确提示？

## 15. 最终判断

当前项目已经具备公告聚合、详情抓取、规则/Agent 分析和基础前端展示能力，但还缺少生产级“数据完整性证明”。

下一步最重要的不是继续优化 Agent prompt 或美化 UI，而是先建立：

> 按来源、按日期、按分页完整抓取，并能证明完整。

只有当系统能证明“今天的数据是完整的”，规则初筛和 Agent 精筛的结果才具备管理层决策价值。
