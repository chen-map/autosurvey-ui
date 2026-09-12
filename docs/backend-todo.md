# 后端任务清单（前端蓝图之外，交由后端角色确认与实现）

> 本文件由变更协议跨栈评估产生：前端侧已用 mock/localStorage 先行，后端就绪后按契约替换。创建日期：2026-09-12

## 1. 知识库持久化（对应前端 F16 知识库）

前端类型：`src/store/library.ts` 的 `LibraryItem`

| 接口 | 说明 |
|---|---|
| `GET /library` | 当前用户收藏列表（含 collection 分类） |
| `POST /library` | 收藏论文（paperIdx 换成真实论文 ID） |
| `DELETE /library/:key` | 移除收藏 |
| `PATCH /library/:key` | 移动分类 |

存储建议：用户维度一张收藏表（user_id, paper_id, collection, saved_at）+ 分类表。前端 localStorage 键 `as.library-items` / `as.library-collections`。

## 2. 研究方向画像持久化（对应前端 F17）

| 接口 | 说明 |
|---|---|
| `GET /me/direction` | `{ fields: string[], goal: string }` |
| `PUT /me/direction` | 更新画像 |

前端 localStorage 键：`as.custom-fields` / `as.last-fields` / `as.research-goal`。

## 3. 选题推荐 / AI 方向精炼（对应 B14/F18；前端 mock 版已并入「研究方向」页）

前端不直连 LLM（密钥安全），由后端代理：

| 接口 | 说明 |
|---|---|
| `POST /direction/refine` | 请求 `{ vaguePrompt: string, fields: string[] }` → 后端调 LLM 按模板精炼为专业研究方向，并经 Semantic Scholar Graph API（免费）检索高质量论文 |
| `GET /projects/:id/gaps` | 包装流水线 **W3-P1 Survey Gap Analyzer**（已有能力）：返回 coverage gaps + methodological gaps + 推荐选题（含 KG 证据支撑） |

响应形状（与前端 `DirectionPage.tsx` 的 `RefinedDirection` 一致）：

```json
{
  "title": "专业化的研究方向标题",
  "statement": "一句话阐述",
  "questions": ["研究问题 1", "研究问题 2", "研究问题 3"],
  "gap": "为什么值得做（识别出的空白）",
  "papers": [{ "title": "...", "venue": "...", "year": 2024, "reason": "推荐理由" }]
}
```

## 4. createProject 载荷扩展（对应向导参数）

`POST /projects` 载荷在原 title/fieldTags/seedPapers 基础上增加：

```json
{
  "platforms": ["Semantic Scholar", "arXiv"],
  "searchCap": 2000,
  "corpusCap": 500,
  "prescore": 0.25,
  "screeningProfile": "标准",
  "localPapers": []
}
```

## 5. 基础设施（部署阶段）

- ECS（放既有 VPC 交换机）+ 弹性公网 IP + 安全组 80/443
- nginx 反代 `/api/*` → FastAPI 流水线包装层；托管前端 dist 静态产物
- 长任务状态推送：轮询起步，预留 SSE
