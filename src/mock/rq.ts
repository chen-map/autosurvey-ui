import type { RQBundle } from '@/types/data';

const paper = (id: string, title: string, venue: string, year: number) => ({ id, title, venue, year });

const EVIDENCE_12 = [
  paper('arXiv:1903.03894', 'GNNExplainer: Generating Explanations for Graph Neural Networks', 'NeurIPS', 2019),
  paper('arXiv:2002.11798', 'PGExplainer: Towards Post-hoc Explanation on GNNs', 'NeurIPS', 2020),
  paper('arXiv:2007.11012', 'Parameterized Explainer for Graph Neural Network', 'ICLR', 2020),
  paper('arXiv:2007.09024', 'PGM-Explainer: Probabilistic Graphical Model Explanations', 'NeurIPS', 2020),
  paper('arXiv:2102.10605', 'GraphMask: Learning to Dropout Edges via Differentiable Masks', 'ICLR', 2021),
  paper('arXiv:2102.08605', 'SubgraphX: Explaining GNNs via Subgraph Exploration', 'ICLR', 2021),
  paper('arXiv:2111.12654', 'RCExplainer: Robust Counterfactual Explanations for GNNs', 'NeurIPS', 2021),
  paper('DOI:10.1109/DSAA.2022', 'Evaluating Explainability for Graph Neural Networks', 'DSAA', 2022),
  paper('arXiv:2304.01986', 'A Unified Framework for Adversarial Robustness of GNN Explanations', 'ICLR', 2023),
  paper('DOI:10.1145/KDD23-hb', 'Benchmarking GNN Explainers: Aligning with Human Intuition', 'KDD', 2023),
  paper('DOI:10.1145/CSUR22-yuan', 'Survey on GNN Interpretability: A Taxonomy', 'ACM CSUR', 2022),
  paper('arXiv:2106.07175', 'Causal Attention for Graph Classification', 'KDD', 2021),
];

export const RQ_BUNDLES: Record<string, RQBundle | null> = {
  // 快照一：全流程完成（图神经网络综述）
  'proj-gnn-survey': {
    macros: [
      { id: 'RQ1', text: '哪些 GNN 可解释性方法已被提出，其原理如何分类？', subs: [
        { id: 'rq1-1', text: '掩码/扰动类方法的原理演进与代表工作', score: 0.92, level: 'strong', paperCount: 12 },
        { id: 'rq1-2', text: '梯度归因方法在图结构上的适配方式', score: 0.88, level: 'strong', paperCount: 9 },
      ] },
      { id: 'RQ2', text: '各类方法在基准数据集上的表现如何横向比较？', subs: [
        { id: 'rq2-1', text: '合成基准（BA-Shapes 等）上的定量对比', score: 0.86, level: 'strong', paperCount: 7 },
        { id: 'rq2-2', text: '真实引文图上的跨数据集泛化', score: 0.81, level: 'weak', paperCount: 5 },
      ] },
      { id: 'RQ3', text: '现有方法面临哪些限制与开放问题？', subs: [
        { id: 'rq3-1', text: '解释稳定性与对抗鲁棒性', score: 0.9, level: 'strong', paperCount: 6 },
        { id: 'rq3-2', text: '异构图上的可解释性', score: 0.47, level: 'blocked', paperCount: 2 },
      ] },
      { id: 'RQ4', text: '评估指标体系如何构成，存在哪些缺陷？', subs: [
        { id: 'rq4-1', text: 'Fidelity/Sparsity 指标族的适用边界', score: 0.87, level: 'strong', paperCount: 5 },
      ] },
    ],
    matrix: {
      frozenAt: '2026-08-28 17:30',
      entries: [
        { subRqId: 'rq1-1', subRqText: '掩码/扰动类方法的原理演进与代表工作', papers: ['arXiv:1903.03894', 'arXiv:2002.11798', 'arXiv:2007.11012', 'arXiv:2007.09024', 'arXiv:2102.10605', 'arXiv:2102.08605'] },
        { subRqId: 'rq1-2', subRqText: '梯度归因方法在图结构上的适配方式', papers: ['arXiv:2111.12654', 'arXiv:2106.07175'] },
        { subRqId: 'rq2-1', subRqText: '合成基准（BA-Shapes 等）上的定量对比', papers: ['arXiv:1903.03894', 'arXiv:2007.11012', 'arXiv:2111.12654'] },
        { subRqId: 'rq2-2', subRqText: '真实引文图上的跨数据集泛化', papers: ['DOI:10.1145/KDD23-hb'] },
        { subRqId: 'rq3-1', subRqText: '解释稳定性与对抗鲁棒性', papers: ['arXiv:2111.12654', 'arXiv:2304.01986'] },
        { subRqId: 'rq3-2', subRqText: '异构图上的可解释性', papers: ['arXiv:2007.09024'] },
        { subRqId: 'rq4-1', subRqText: 'Fidelity/Sparsity 指标族的适用边界', papers: ['DOI:10.1109/DSAA.2022', 'DOI:10.1145/CSUR22-yuan'] },
      ],
    },
    overallAnswer:
      '掩码/扰动类方法是当前图神经网络可解释性的主流范式 [1][2][3]。GNNExplainer 首次将解释建模为边级软掩码的学习问题 [1]，PGExplainer 将其扩展为参数化的生成式掩码 [2]，SubgraphX 则将解释单元从边提升到子图粒度 [6]。在 BA-Shapes 等合成基准上，参数化掩码方法（PGExplainer）的 Fidelity+ 较梯度基线平均提升 12–18% [2][4]。评估体系以 Fidelity+/− 与 Sparsity 为主 [11][12]，但基准数据集过于合成、解释稳定性评估缺失是普遍缺陷 [7][9][11]。异构图场景的证据尚不充分（Answerability 0.47，blocked）[4]，构成本综述识别的核心开放问题之一。',
    claims: [
      { id: 'C1', text: '掩码类方法通过学习边级软掩码实现实例级解释，已成为 GNN 可解释性的主流范式 [1][3]', status: 'verified', dims: { citation: true, semantic: true, coverage: true, crossPaper: true }, sources: [ { paperId: 'arXiv:1903.03894', locator: '§4.1 Fig.3', kgPath: 'Paper ─proposes→ Method(GNNExplainer)' }, { paperId: 'arXiv:2002.11798', locator: '§3.2', kgPath: 'Method(PGExplainer) ─extends→ Method(GNNExplainer)' } ] },
      { id: 'C2', text: 'PGExplainer 将掩码从逐实例学习升级为跨实例共享的参数化生成器 [2]', status: 'verified', dims: { citation: true, semantic: true, coverage: true, crossPaper: true }, sources: [ { paperId: 'arXiv:2002.11798', locator: '§3.1', kgPath: 'Method ─extends→ Method' } ] },
      { id: 'C3', text: 'SubgraphX 将解释单元从边级提升到子图级，通过 Shapley 值搜索最优子图 [6]', status: 'verified', dims: { citation: true, semantic: true, coverage: true, crossPaper: true }, sources: [ { paperId: 'arXiv:2102.08605', locator: '§3', kgPath: 'Method ─compares_with→ Method' } ] },
      { id: 'C4', text: '在 BA-Shapes 基准上，参数化掩码方法的 Fidelity+ 较梯度基线平均提升 12–18% [2][4]', status: 'verified', dims: { citation: true, semantic: true, coverage: true, crossPaper: true }, sources: [ { paperId: 'arXiv:2002.11798', locator: '§5.2 Table 2', kgPath: 'Method ─evaluated_on→ Dataset(BA-Shapes) ─measured_by→ Metric' }, { paperId: 'arXiv:2007.09024', locator: '§6.1', kgPath: 'Metric ─contradicts→ Metric' } ] },
      { id: 'C5', text: '现有评估以 Fidelity+/− 与 Sparsity 为主，缺乏解释稳定性维度 [11][12]', status: 'verified', dims: { citation: true, semantic: true, coverage: true, crossPaper: true }, sources: [ { paperId: 'DOI:10.1109/DSAA.2022', locator: '§4', kgPath: 'Paper ─addresses→ Limitation' }, { paperId: 'DOI:10.1145/CSUR22-yuan', locator: '§6.2', kgPath: 'Limitation' } ] },
      { id: 'C6', text: '基准数据集过于合成是解释方法泛化能力评估的核心障碍 [9][11]', status: 'verified', dims: { citation: true, semantic: true, coverage: true, crossPaper: true }, sources: [ { paperId: 'arXiv:2304.01986', locator: '§2.3', kgPath: 'AssumptionConstraint ─background→ Paper' }, { paperId: 'DOI:10.1145/CSUR22-yuan', locator: '§5', kgPath: 'Limitation' } ] },
      { id: 'C7', text: '所有扰动类方法在全部基准上均显著优于梯度归因方法', status: 'needs_revision', dims: { citation: true, semantic: true, coverage: false, crossPaper: true }, sources: [ { paperId: 'arXiv:2106.07175', locator: '§7', kgPath: 'Paper ─contradicts→ Paper' } ], note: '覆盖完整性不通过：Yuan 等 [11] 指出梯度方法在引文图上仍有竞争力，"全部""显著"表述过强。建议改为"在合成基准上普遍优于"。' },
      { id: 'C8', text: '子图解释方法在所有数据集上将 F1 提升 30% 以上', status: 'should_remove', dims: { citation: true, semantic: false, coverage: true, crossPaper: true }, sources: [ { paperId: 'arXiv:2102.08605', locator: '§5.1 Table 1', kgPath: 'Metric ─contradicts→ Metric' } ], note: '引文准确性不通过：原文数值为 12–18%，与声明严重不符，系统已自动剔除该声明。' },
    ],
    evidencePapers: EVIDENCE_12,
    evidenceGaps: ['防御/鲁棒性视角的可解释性评估覆盖不足（3 篇候选待复核）', '异构图场景仅 2 篇证据，低于阈值'],
  },
  // 快照二：W3 进行中，矩阵未冻结
  'proj-llm-agent-safety': { macros: [], matrix: null, overallAnswer: '', claims: [], evidencePapers: [], evidenceGaps: [] },
  'proj-diffusion-draft': null,
};
