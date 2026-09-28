# Layer 1：KG 操作层 进度

| 模块 | 文件 | 状态 | 说明 |
|------|------|------|------|
| KG 数据加载器 | kg_loader.py | 🔲 待实现 | |
| 提取工具 | extract_tools.py | 🔲 待实现 | get_entity_by_type 等 6 个工具 |
| 逻辑工具 | logic_tools.py | 🔲 待实现 | count / intersect / union / judge / end |
| 语义工具 | semantic_tools.py | 🔲 待实现 | retrieve_relation / disambiguate_entity |
| 工具注册表 | tool_registry.py | 🔲 待实现 | 统一调用入口 |

## 工具清单

### 提取工具（extract_tools.py）

| 工具名 | 功能 |
|--------|------|
| `get_entity_by_type(loader, entity_type)` | 按 node_type 返回所有匹配实体 |
| `get_entity_by_constraint(entities, field, op, value)` | 按字段+运算符过滤实体（==, !=, >, <, >=, <=, in, contains） |
| `get_relation(loader, entity_id, direction)` | 获取实体的一跳关系边（in/out/both） |
| `get_head_entity(loader, edge_type, tail_id)` | 按边类型反向查询头实体 |
| `get_tail_entity(loader, edge_type, head_id)` | 按边类型正向查询尾实体 |
| `get_candidate_entity(loader, mention, entity_type)` | 文本 mention → KG 实体候选（基于字符串匹配 + embedding） |

### 逻辑工具（logic_tools.py）

| 工具名 | 功能 |
|--------|------|
| `count(entities)` | 返回实体列表长度 |
| `intersect(list_a, list_b, key)` | 两个列表按 key 字段求交集 |
| `union(list_a, list_b, key)` | 两个列表按 key 字段求并集 |
| `judge(value, op, threshold)` | 条件判断，返回布尔值 |
| `end(answer)` | 包装最终答案为标准 dict |

### 语义工具（semantic_tools.py）

| 工具名 | 功能 |
|--------|------|
| `retrieve_relation(loader, query_text, topk)` | 基于 sentence-transformers 检索最相关的边类型名 |
| `disambiguate_entity(candidates, context_text)` | 按上下文相似度对候选实体排序，返回最优实体 |
