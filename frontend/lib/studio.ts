import type { WorkflowSession } from "@/lib/types";

export interface StudioModule {
  id: string;
  title: string;
  status: string;
  description: string;
  highlights: string[];
}

export interface StageBlueprint {
  title: string;
  intent: string;
  aiAction: string;
  humanAction: string;
  prompt: string;
}

const CALCULATION_TYPE_LABELS: Record<string, string> = {
  relaxation: "结构弛豫",
  scf: "SCF",
  static: "静态计算",
  dos: "DOS",
  "band structure": "能带结构",
  "single point": "单点计算",
  "surface reaction": "表面反应",
};

const SCHEDULER_TYPE_LABELS: Record<string, string> = {
  direct: "直接 shell",
  slurm: "SLURM",
  pbs: "PBS",
};

export const STUDIO_MODULES: StudioModule[] = [
  {
    id: "materials",
    title: "材料导入",
    status: "人机协同就绪",
    description:
      "收集 POSCAR、CIF、Materials Project 片段或手工备注，并支持 AI 辅助规范化与科研人员显式编辑。",
    highlights: ["POSCAR/CIF 粘贴与上传", "AI 来源摘要", "手动记录来源"],
  },
  {
    id: "preprocess",
    title: "AI 预检查",
    status: "框架已就绪",
    description:
      "为 DFT 派发前的对称性检查、磁性位点提示、氧化态猜测和结构清理预留工作区。",
    highlights: ["元素/数量检查", "磁性与 U 值提示", "人工批准关口"],
  },
  {
    id: "visuals",
    title: "可视化实验室",
    status: "入口已预留",
    description:
      "承载结构视图、轨迹缩略图、标量趋势和结果图表，并保留后续替换可视化库的空间。",
    highlights: ["结构视图入口", "轨迹预览通道", "结果卡片与图表"],
  },
  {
    id: "parameters",
    title: "参数副驾",
    status: "API 已连接",
    description:
      "把 RAG 式参数检索、推荐理由、可编辑草稿和验证入库放在同一个可审查界面。",
    highlights: ["推荐工作流", "知识检索", "批准或验证入库"],
  },
  {
    id: "compute",
    title: "DFT 后端桥接",
    status: "API 已连接",
    description:
      "把已批准任务路由到本地 ASE/VASP 或 SSH 集群，并为调度器和未来执行适配器保留扩展位。",
    highlights: ["ASE 启动路径", "SSH 与调度器元数据", "执行监控"],
  },
  {
    id: "mlip",
    title: "MLIP 预探",
    status: "框架就绪",
    description:
      "在昂贵 DFT 提交前提供轻量 MLIP 通道，用于预弛豫预览和粗略轨迹检查。",
    highlights: ["模型选择入口", "轨迹趋势预览", "运行前人工对比"],
  },
];

export const STAGE_BLUEPRINTS: Record<string, StageBlueprint> = {
  "structure-prep": {
    title: "结构准备",
    intent: "描述材料体系并记录结构来源。",
    aiAction: "规范化导入备注并准备结构上下文。",
    humanAction: "确认材料身份、来源和计算目标。",
    prompt: "总结已提供的材料上下文，并给出清晰的结构准备检查清单。",
  },
  "poscar-validation": {
    title: "POSCAR 验证",
    intent: "检查元素顺序、原子数量、坐标模式和明显结构问题。",
    aiAction: "标记可疑晶格/数量模式和缺失元数据。",
    humanAction: "审查结构合理性检查，并确认或覆盖结论。",
    prompt: "审查当前 POSCAR 内容，给出验证备注，并列出需要科研人员确认的问题。",
  },
  "incar-recommendation": {
    title: "INCAR 推荐",
    intent: "建议保守且有充分理由的 DFT 控制参数。",
    aiAction: "生成带有理由、不确定性和来源线索的 INCAR 建议。",
    humanAction: "在参数被用于后续步骤前编辑并批准最终值。",
    prompt: "为该工作流推荐 INCAR 参数，并解释关键选择背后的科学取舍。",
  },
  "kpoints-configuration": {
    title: "KPOINTS 配置",
    intent: "为所选任务估计合理的网格策略或路径设置。",
    aiAction: "提出网格密度和对称性感知默认值。",
    humanAction: "根据收敛风险和计算成本调整采样计划。",
    prompt: "为该材料体系推荐 KPOINTS 策略，包含密度建议和注意事项。",
  },
  "potcar-guidance": {
    title: "POTCAR 指引",
    intent: "建议赝势族，并突出需要领域判断的情况。",
    aiAction: "指出可能的 POTCAR 选择，以及半芯态或 +U 考量。",
    humanAction: "确认目标数据集和课题组/机构约定。",
    prompt: "为该体系推荐 POTCAR 指引，并指出需要专家审查的情况。",
  },
  "submission-prep": {
    title: "提交准备",
    intent: "把已批准的物理参数映射为计算资源决策和启动设置。",
    aiAction: "建议队列、任务数、墙时和启动方式。",
    humanAction: "核对机器、调度器和资源预算。",
    prompt: "为该工作流推荐提交设置，平衡稳定性、成本和周转时间。",
  },
  "result-review": {
    title: "结果审查",
    intent: "总结执行后的收敛情况、质量信号和下一步行动。",
    aiAction: "基于最新执行输出草拟审查摘要。",
    humanAction: "验证科学充分性，并决定哪些内容进入知识库。",
    prompt: "总结该工作流的执行输出、收敛状态和建议后续操作。",
  },
};

export function getStageBlueprint(stageKey: string): StageBlueprint {
  return (
    STAGE_BLUEPRINTS[stageKey] ?? {
      title: stageKey,
      intent: "未知阶段目标。",
      aiAction: "为所选阶段生成建议。",
      humanAction: "审查并批准生成的数值。",
      prompt: "为所选工作流阶段提供建议。",
    }
  );
}

export function formatCalculationType(calculationType: string | null | undefined): string {
  if (!calculationType) {
    return "计算类型待定";
  }
  return CALCULATION_TYPE_LABELS[calculationType.toLowerCase()] ?? calculationType;
}

export function formatSchedulerType(schedulerType: string | null | undefined): string {
  if (!schedulerType) {
    return "调度器待定";
  }
  return SCHEDULER_TYPE_LABELS[schedulerType.toLowerCase()] ?? schedulerType;
}

export function summarizeSessionProgress(session: WorkflowSession): {
  total: number;
  approved: number;
  validated: number;
  readyPercent: number;
} {
  const total = session.steps.length;
  const approved = session.steps.filter((step) =>
    ["approved", "completed", "validated"].includes(step.status.toLowerCase())
  ).length;
  const validated = session.steps.filter((step) => step.validated).length;
  const readyPercent = total > 0 ? Math.round((approved / total) * 100) : 0;

  return { total, approved, validated, readyPercent };
}
