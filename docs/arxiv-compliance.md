# arXiv 数据获取合规与稳定性清单

> 来源：用户提供的 arXiv 合规最佳实践（2026-09-22 落地）。实现：`backend/w1/arxiv_oai.py`，接入 W1-P2 steps_tail。

| 最佳实践 | 状态 | 实现位置 |
|---|---|---|
| 合规 User-Agent（机构名 + 联系方式 + OAI-PMH 声明） | ✅ | `arxiv_oai.py` UA: `AutoSurvey-SLR-Bot/1.0 (<contact>; supports OAI-PMH)`，contact 来自 config `contact_email` |
| OAI-PMH 替代高频 REST 抓取元数据 | ✅ | `ListRecords` + `metadataPrefix=arXiv`，端点 `oaipmh.arxiv.org/oai`（旧 oai2 已迁移），set 用合法值（`cs` 等，可 ListSets 查询） |
| resumptionToken 分页，避免重复请求 | ✅ | `parse_resumption_token` 循环翻页 |
| 429 按 Retry-After + 指数退避 | ✅ | `request_with_backoff`：优先 Retry-After，否则 2^n 上限 8 轮 |
| 每日最大请求数上限 | ✅ | `DAILY_CAP=2000`，`oai_daily_state.json` 持久化当日计数，超限熔断（次日自动恢复） |
| 请求间隔 ≥1 req/s | ✅ | `MIN_INTERVAL=1.1s` 翻页间隔 |
| 本地缓存减少重复请求 | ✅（部分） | `paper_cache.sqlite3`（DOI 级缓存）承担检索去重；OAI 侧记录增量时间戳（--from）避免重复拉取 |
| 增量同步 | ✅ | `--from YYYY-MM-DD` 按 P1 检索年份范围起点拉取 |
| 记录完整日志 | ✅ | 采集统计 `arxiv_oai_stats.json` + step 日志（runner 归档） |
| robots.txt / 代理池 | ⛔ 不适用 | 单机科研用途，无 HTML 抓取、无分布式 |
| 与 arXiv 团队建立联系 | ⏳ | 如需大规模采集，用机构邮箱替换 `contact_email` 配置 |

## 集成方式

`w1/phase_defs.py` W1-P2 `steps_tail`：在七库检索完成后，OAI-PMH 按 `oai_sets`（默认 cs）+
年份范围增量采集 → `raw_results/arxiv_oai_results.csv`（与其他源同 schema，**注入官方
DOI `10.48550/arXiv.<id>`**）→ P3 归一去重自然合流 → 全链路 DOI 锚定不受影响。

## 已知限流现状（2026-09-22 实测）

- **Semantic Scholar 公共 API**：无 Key 时 ~1 req/s 且大量 429——P5 滚雪球 646 篇会耗时
  数小时。已做优雅降级（超时/429 按篇跳过）；真实跑批建议配置 S2 API Key（免费申请）。
- **arXiv REST**（P2 现有检索）：内置 sleep 限速，可用；大规模时 OAI-PMH 路径更稳。
