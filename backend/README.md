# AutoSurvey Backend · W1 固定工作流执行器

确定性流水线执行层（设计：`docs/w1-pipeline-design.md`）。分层：

```
backend/
├── w1/
│   ├── phase_defs.py   # W1 七个 Phase 的脚本/参数/产物定义（配置驱动）
│   └── runner.py       # 状态机：顺序执行、断点续跑、单点重跑、产物校验、状态落盘
├── tests/              # 执行器状态机测试（假脚本，不依赖真实 autoSurvey_v2）
└── requirements.txt
```

- **存量脚本零改动**：`scripts_root` 指向 autoSurvey_v2 目录即可；所有脚本以 workspace 为工作目录执行
- **状态**：`w1_state.json`（phase 级 status/耗时/产物/rc）——前端 B3 页 `phase_states` 的一一对应
- **日志**：`logs/{Phase}_step{n}.log`（stdout/stderr 全量重定向，B3 日志面板直接消费）

```bash
python -m pytest tests/ -v          # 状态机测试
python w1/runner.py --config w1_config.json --resume
```

## 里程碑

- ✅ **M-B1**（本次）：P0 整改（Sci-Hub 绕过 / rapidfuzz 断言）+ 执行器 + 状态机测试
- ⬜ M-B2：FastAPI 薄壳（create/status/retry/logs）→ 前端 B3 切真实数据源
- ⬜ M-B3：`llm_screen.py` P4 判断收敛层（固定 prompt + temperature=0 + 缓存 + 启发式兜底）
- ⬜ M-B4：api-contract.md 定稿 + W2 同模式固化
