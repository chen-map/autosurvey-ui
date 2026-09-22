# arXiv 数据获取合规与稳定性清单

> 来源：用户提供的 arXiv 合规最佳实践（2026-09-22 落地）。实现：`backend/w1/arxiv_oai.py`，接入 W1-P2 steps_tail。
> 下载侧：`backend/w1/arxiv_batch.py`（W1-P6 arXiv 批量直连先行），限速模式参考
> CocoLoop 商店技能 arxiv-paper-processor（CLS A 级，未随仓库分发），参数经本地实测校准。

## 元数据采集（arxiv_oai.py）

| 最佳实践 | 状态 | 实现位置 |
|---|---|---|
| 合规 User-Agent（机构名 + 联系方式 + OAI-PMH 声明） | ✅ | `arxiv_oai.py` UA: `AutoSurvey-SLR-Bot/1.0 (<contact>; supports OAI-PMH)`，contact 来自 config `contact_email` |
| OAI-PMH 替代高频 REST 抓取元数据 | ✅ | `ListRecords` + `metadataPrefix=arXiv`，端点 `oaipmh.arxiv.org/oai`（旧 oai2 已迁移），set 用合法值（`cs` 等，可 ListSets 查询） |
| resumptionToken 分页，避免重复请求 | ✅ | `parse_resumption_token` 循环翻页；连续 2 页解析 0 条自动熔断（防结构性翻库） |
| 429 按 Retry-After + 指数退避 | ✅ | `request_with_backoff`：优先 Retry-After，否则 2^n 上限 8 轮；**超过 6 次放弃**（防无限重试挂死 pipeline） |
| 每日最大请求数上限 | ✅ | `DAILY_CAP=2000`，`oai_daily_state.json` 持久化当日计数，超限熔断（次日自动恢复） |
| 请求间隔 ≥1 req/s | ✅ | `MIN_INTERVAL=1.1s` 翻页间隔 |
| 显式 Accept 头 | ✅ | urllib 默认无 `Accept`，arXiv CDN 会 406（实测）——已带 `Accept: */*` |
| 解析对齐真实响应 | ✅ | 记录根元素为**无前缀裸标签** `<arXiv xmlns="...">`，字段 `<id>/<title>/<authors>` 同为裸标签；authors 按 `<author><forenames>/<keyname>` 结构化解析（单页 1300 条实测 100% 解出） |
| 本地缓存减少重复请求 | ✅（部分） | `paper_cache.sqlite3`（DOI 级缓存）承担检索去重；OAI 侧记录增量时间戳（--from）避免重复拉取 |
| 增量同步 | ✅ | `--from YYYY-MM-DD` 按 P1 检索年份范围起点拉取（OAI 语义为 datestamp 过滤，被更新的旧文也会出现，属正常） |
| 记录完整日志 | ✅ | 采集统计 `arxiv_oai_stats.json` + step 日志（runner 归档） |
| robots.txt / 代理池 | ⛔ 不适用 | 单机科研用途，无 HTML 抓取、无分布式 |
| 与 arXiv 团队建立联系 | ⏳ | 如需大规模采集，用机构邮箱替换 `contact_email` 配置 |

## PDF 下载（arxiv_batch.py，W1-P6）

痛点：旧五级降级链对 arXiv 论文也逐级试错（每级长超时、无全局冷却），60 篇实测 786s
仅成功 2 篇。方案：OAI 收割的记录带官方 DOI `10.48550/arXiv.<id>`，直接批量直连
`export.arxiv.org/pdf/<id>`，剩余无 arXiv ID 的才交给旧链路兜底。

| 机制 | 说明 |
|---|---|
| 共享节流状态文件 | `papers/.runtime/arxiv_download_state.json` 记录 `last_request_ts` + `cooldown_until_ts`；每个请求先取 slot（默认 **5s 间隔 ≈ 12 篇/分钟**） |
| 服务器全局冷却 | 失败时把指数退避写入状态，**后续所有请求共享冷却**（上限 120s） |
| 重试上限 | 每轮 4 次；429/5xx/网络错误/传输断流（IncompleteRead）均退避重试（上限 120s + 抖动） |
| 三级传输通道 | **curl 子进程直连（首选）→ urllib 跟系统代理 → urllib 直连**。实测 arXiv CDN（Cloudflare 类）按 TLS/HTTP 指纹过滤：python-urllib 请求在缓存未命中时被 406 拒绝，同 URL curl 直连 200；30 篇实测 curl 通道 100% 成功 |
| 版本号降级 | 无版本号 ID 遇 404/406 时自动试 `v1`（arXiv 已对部分旧论文停用无版本 PDF URL） |
| 断点续传 | 已存在且 >1KB + `%PDF` 魔数的直接跳过；文件命名与 `download_papers.py safe_filename` 完全一致，旧链路 `--skip-existing` 无缝衔接 |
| 完整性校验 | `%PDF` 魔数 + ≥5KB（拦截 arXiv 错误页/占位响应），不足记 `invalid_content` |
| 统计产物 | `download/arxiv_batch_stats.json`：cached/downloaded/failed/no_arxiv_id 全计数 + 逐篇状态 |

## 集成方式

`w1/phase_defs.py`：

- **W1-P2 `steps_tail`**：七库检索完成后，OAI-PMH 按 `oai_sets`（默认 cs）+ 年份范围
  增量采集 → `raw_results/arxiv_oai_results.csv`（与其他源同 schema，**注入官方 DOI
  `10.48550/arXiv.<id>`**）→ P3 归一去重自然合流 → 全链路 DOI 锚定不受影响。
- **W1-P6**：`download_prep.py`（DOI 锚定）→ `arxiv_batch.py`（arXiv 子集批量直连，
  配置键 `arxiv_dl_min_interval`，默认 5.0）→ `download_papers.py`（旧五级链兜底 +
  `--skip-existing`）→ `corpus_ingest.py` 入库。

## 已知限流现状（2026-09-22 实测）

- **Semantic Scholar 公共 API**：无 Key 时 ~1 req/s 且大量 429——P5 滚雪球 646 篇会耗时
  数小时。已做优雅降级（超时/429 按篇跳过）；真实跑批建议配置 S2 API Key（免费申请）。
- **arXiv REST**（P2 现有检索）：内置 sleep 限速，可用；大规模时 OAI-PMH 路径更稳。
- **arXiv PDF**：arxiv_batch（curl 通道）30/30 全成功；无版本号旧 ID 需 `v1` 降级（已内置）。
  付费库仍靠 Unpaywall/出版社 OA 兜底，失败会留占位符。
- **urllib 指纹教训**：Python urllib 在 arXiv CDN 上不可靠（缺 Accept 头 406 + TLS 指纹
  过滤），采集层凡直连 arXiv 的新代码一律走 curl 或补齐头并备好兜底通道。
