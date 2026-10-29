# 开源及第三方资源使用清单

> 下表版本已于 **2026-10-29** 与实际运行环境核对：后端为部署环境 `pip freeze` 的关键项，前端为 `package-lock.json` 锁定版本。完整 SBOM 可按 §6 的命令生成。

## 1. 运行时与开发组件（后端，Python 3.12）

| 名称 | 版本（实测） | 来源 | 许可证/授权 | 使用方式 | 关键许可义务 | 自主修改 |
|---|---|---|---|---|---|---|
| FastAPI | 0.141.1 | github.com/fastapi/fastapi | MIT | 后端 API 框架 | 保留版权与许可声明 | 未修改 |
| Uvicorn | 0.53.0 | github.com/encode/uvicorn | BSD-3-Clause | ASGI 服务器 | 保留版权与许可声明 | 未修改 |
| Pydantic | 2.13.5 | github.com/pydantic/pydantic | MIT | 请求/配置校验 | 保留版权与许可声明 | 未修改 |
| pandas | 3.0.6 | github.com/pandas-dev/pandas | BSD-3-Clause | 表格与统计处理 | 保留版权与许可声明 | 未修改 |
| NumPy | 2.5.3 | numpy.org | BSD-3-Clause | 数值计算 | 保留版权与许可声明 | 未修改 |
| requests | 2.34.2 | github.com/psf/requests | Apache-2.0 | 检索与下载 HTTP 客户端 | 保留 NOTICE/许可 | 未修改 |
| RapidFuzz | 3.14.6 | github.com/rapidfuzz/RapidFuzz | MIT | 标题/文本相似匹配 | 保留版权与许可声明 | 未修改 |
| pytest | 9.1.1 | pytest.org | MIT | 测试 | 保留版权与许可声明 | 未修改 |
| cryptography | 50.0.1 | github.com/pyca/cryptography | Apache-2.0 OR BSD-3-Clause | API Key 加密存储（Fernet） | 保留许可与 NOTICE | 未修改 |
| PyMuPDF | 1.28.2 | github.com/pymupdf/PyMuPDF | **AGPL-3.0-or-later 或商业许可** | PDF 文本/坐标解析、证据页定位 | **AGPL：分发或提供网络服务时须按 AGPL 提供对应源码；否则购买商业许可** | 未修改 |
| pdfminer.six | 20260107 | github.com/pdfminer/pdfminer.six | MIT | PDF 文本解析降级通道 | 保留版权与许可声明 | 未修改 |
| python-multipart | 0.0.32 | github.com/Kludex/python-multipart | Apache-2.0 | 文件上传 | 保留许可 | 未修改 |
| Matplotlib | 3.11.2 | matplotlib.org | PSF-based（Matplotlib License） | 图表生成 | 保留版权与许可声明 | 未修改 |
| Anthropic Python SDK | 1.8.0 | github.com/anthropics/anthropic-sdk-python | MIT | 调用 Anthropic 协议端点（含兼容网关） | 保留版权与许可声明；遵守 API 条款 | 未修改 |
| sentence-transformers | 6.1.0 | github.com/UKPLab/sentence-transformers | Apache-2.0 | 语义召回/向量相似（间接依赖 torch 2.14.0、transformers 5.17.0） | 保留许可与 NOTICE；模型权重另按其许可 | 未修改 |

> 会话认证与密码哈希使用 `cryptography`（Fernet/HMAC）与标准库实现，未引入额外认证库。

## 2. 前端与可视化

| 名称 | 版本（锁定） | 来源 | 许可证 | 使用方式 | 关键义务 | 修改 |
|---|---|---|---|---|---|---|
| React / React DOM | 18.3.1 | react.dev | MIT | UI 框架 | 保留版权与许可 | 未修改 |
| Vite | 5.4.21 | vitejs.dev | MIT | 构建工具 | 保留版权与许可 | 未修改 |
| TypeScript | 5.9.3 | typescriptlang.org | Apache-2.0 | 类型系统 | 保留 NOTICE/许可 | 未修改 |
| Tailwind CSS | 3.4.19 | tailwindcss.com | MIT | 样式 | 保留版权与许可 | 未修改 |
| Zustand | 4.5.7 | github.com/pmndrs/zustand | MIT | 状态管理 | 保留版权与许可 | 未修改 |
| React Router | 6.30.6 | reactrouter.com | MIT | 路由 | 保留版权与许可 | 未修改 |
| d3-force | 3.0.0 | d3js.org | ISC | 力导向图布局 | 保留版权与许可 | 未修改 |
| @xyflow/react | 12.11.6 | reactflow.dev | MIT | 图编辑/画布 | 保留版权与许可 | 未修改 |
| lucide-react | 0.441.0 | lucide.dev | ISC | 图标 | 保留版权与许可 | 未修改 |
| react-markdown | 10.1.0 | github.com/remarkjs/react-markdown | MIT | Markdown 渲染 | 保留版权与许可 | 未修改 |
| clsx / tailwind-merge | 2.1.1 / 2.6.1 | 各自上游 | MIT | 类名合并 | 保留版权与许可 | 未修改 |
| PostCSS / Autoprefixer | 8.5.28 / 10.5.6 | postcss.org | MIT | 样式构建 | 保留版权与许可 | 未修改 |

## 3. 排版与文档工具

| 名称 | 版本 | 来源 | 许可证 | 使用方式 | 关键义务 | 修改 |
|---|---|---|---|---|---|---|
| tectonic | 0.15.x（服务器安装） | tectonic-typesetting.github.io | MIT | LaTeX 编译（W5-P4） | 保留版权与许可 | 未修改；二进制不随公开仓分发 |
| TeX Live 宏包 | 发行版 | tug.org | LPPL 等 | 综述 PDF 排版 | LPPL：修改文件需改名并保留许可；未修改则直接使用 | 未修改 |
| IEEEtran.bst / acmart.cls | 模板版 | CTAN | LPPL-1.3c | 参考文献与版式 | 同上；不得删除模板版权声明 | 仅按模板参数使用，未改模板文件 |

## 4. 模型服务与数据源

| 名称 | 版本 | 来源 | 许可/条款 | 使用方式 | 关键义务/限制 | 修改 |
|---|---|---|---|---|---|---|
| DeepSeek API | 服务版 | platform.deepseek.com | 商业服务条款 | 论文抽取、RQ 设计、分析、写作 | 遵守服务条款与内容政策；不将受限数据用于未授权训练 | 通过统一 LLM 适配层调用 |
| Anthropic API | 服务版 | anthropic.com | 商业服务条款 | 可选模型后端 | 同上 | 通过统一 LLM 适配层调用 |
| arXiv API | 服务版 | arxiv.org | arXiv API 使用条款 | 检索与元数据 | 控制请求频率；PDF 版权归作者/出版方，不再分发全文 | 仅元数据与本地解析 |
| OpenAlex | 服务版 | openalex.org | 元数据 CC0 | 文献元数据 | 保留来源标识；CC0 不覆盖第三方摘要/全文 | 仅元数据 |
| Crossref | 服务版 | crossref.org | 元数据使用条款 | DOI/题录核验 | 遵守速率与署名要求 | 仅元数据 |
| Semantic Scholar | 服务版 | semanticscholar.org | API 条款 | 补充检索 | 遵守速率与存储限制 | 仅元数据 |
| IEEE Xplore 等订阅库 | 按配置 | 各出版方 | 订阅/使用条款 | 检索与下载（用户自带权限） | **不得批量再分发全文或摘要** | 仅本地解析 |

## 5. 高风险项与当前处理

1. **PyMuPDF / AGPL**：生产部署为私有内网服务。公开仓库中的 `open/pipeline/tools/build_paper_evidence_index.py` 是**源码摘录（阅读参考）**，不构成基于 PyMuPDF 的网络服务分发；若后续公开可运行的后端或对外提供网络服务，应二选一：按 AGPL-3.0 提供完整对应源码，或购买 Artifex 商业许可；公开工具优先改用 `pypdf`/`pdfminer.six`。
2. **论文版权**：公开快照不包含论文全文；`corpus.json` 已移除摘要；证据图为定位引文所需的最短页面条带。公开版仅保留题录、DOI、页码与短引文；如出版方提出异议，可下线对应条目。
3. **模型服务条款**：模型 API 为商业服务，不作为“开源模型”宣传；如需强调开放模型，应改用 Qwen/DeepSeek 等开放权重版本并在本地部署，另行核对权重许可。
4. **LaTeX 模板**：IEEEtran/acmart 为 LPPL，未修改模板文件；如修改，需改名并保留许可声明。
5. **字体**：界面使用系统字体；如后续打包 Noto Serif SC 等字体，需附 OFL 许可与版权声明。

## 6. 生成完整清单

```bash
# 前端
npm ls --all --json > sbom-npm.json

# 后端（在部署环境）
pip freeze > sbom-python.txt
```
