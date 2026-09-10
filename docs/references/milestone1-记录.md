# 里程碑 1 交付记录 · AutoSurvey 前端

> 2026-09-11 ｜ 状态：✅ 已交付并通过浏览器实测

## 交付内容（对应 requirements.md）

| 编号 | 内容 | 实现 |
|---|---|---|
| B0-1 | 登录页 | 黑白登录卡 + 演示账号预填（demo/123456）+ 内联错误 |
| B0-2 | 全局框架 | 左侧栏（黑 wordmark + 实底黑主按钮 + 分组导航 + 底部状态区） |
| F0-3 | 只读演示模式 | 侧栏开关，开启后隐藏「新建综述项目」 |
| F0-4 | mock 层 + API 契约 | `services/api.ts`（REST 语义签名 + 模拟延迟，后端定稿只换实现）+ `types/index.ts`（契约类型）+ 两个数据快照 |
| B1 | 项目列表 | 卡片栅格 + 5W 分段进度 + 规模统计 + 搜索/排序/计数 |

## 浏览器实测（1440×900，截图见本目录）

- 登录 → 跳转 /projects ✓
- 搜索「图神经」过滤 → 1/3 ✓
- 十项反幼稚审计：**通过**（期间修复 2 处：徽标竖排换行 → `whitespace-nowrap`；W 标签 10px 野生字号 → 12px 字阶）

## 截图

- `milestone1-login.png` 登录页
- `milestone1-projects-修复前.png` 修复前（草稿徽标竖排）
- `milestone1-projects-搜索过滤.png` 搜索过滤验证
- `milestone1-projects-终版.png` 终版

## 运行

```bash
npm install && npm run dev   # http://localhost:5173，demo / 123456
```

## 遗留到下一里程碑
- B7/B8 RQ 树 + 证据核查（W4 门面）
- 快照数据扩展：rq 树、claims 列表、冻结矩阵的 mock 明细
