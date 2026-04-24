"use client";

import Link from "next/link";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Database,
  FileText,
  History,
  Play,
  RefreshCw,
  Send,
  Settings,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { StatusPill } from "@/components/status-pill";
import {
  approveStep,
  createChatMessage,
  generateRecommendations,
  getChatMessages,
  getExecutions,
  refreshExecution,
  searchKnowledge,
  submitExecution,
  updateWorkflowSession,
  validateStep,
} from "@/lib/api";
import {
  formatCalculationType,
  formatSchedulerType,
  getStageBlueprint,
  summarizeSessionProgress,
} from "@/lib/studio";
import type {
  ConversationMessage,
  ExecutionRecord,
  JsonValue,
  KnowledgeEntry,
  SSHConnectionProfile,
  StepParameter,
  WorkflowSession,
  WorkflowStep,
} from "@/lib/types";

interface WorkflowWizardProps {
  initialSession: WorkflowSession;
  connections: SSHConnectionProfile[];
}

interface WorkflowTool {
  id: string;
  title: string;
  description: string;
  actionLabel: string;
  icon: LucideIcon;
}

type ToolResult = "done" | "reported";

const DONE_STATUSES = new Set(["approved", "completed", "validated"]);

const STATUS_LABELS: Record<string, string> = {
  pending: "待处理",
  recommended: "已推荐",
  approved: "已批准",
  validated: "已验证",
  completed: "已完成",
  failed: "失败",
  running: "运行中",
  submitted: "已提交",
  queued: "排队中",
  cancelled: "已取消",
  execution_failed: "执行失败",
  "execution-failed": "执行失败",
};

const PARAMETER_CATEGORY_LABELS: Record<string, string> = {
  context: "上下文",
  validation: "验证",
  sampling: "采样",
  pseudopotential: "赝势",
  execution: "执行",
  review: "审查",
  fallback: "兜底",
  accuracy: "精度",
  convergence: "收敛",
  electronic: "电子",
  magnetism: "磁性",
  ionic: "离子",
  correlation: "关联",
  general: "通用",
};

const ROLE_LABELS: Record<ConversationMessage["role"], string> = {
  user: "用户",
  assistant: "智能体",
  system: "系统",
};

const STAGE_TOOLS: Record<string, WorkflowTool[]> = {
  "materials-prep": [
    {
      id: "source-import",
      title: "结构导入器",
      description: "粘贴 POSCAR/CIF、上传文件，并确认材料来源。",
      actionLabel: "打开导入器",
      icon: FileText,
    },
    {
      id: "structure-preview",
      title: "结构预览",
      description: "查看行数、元素行、估算原子数和坐标模式。",
      actionLabel: "打开预览",
      icon: Wrench,
    },
    {
      id: "poscar-check",
      title: "POSCAR 检查器",
      description: "检查元素顺序、数量行、坐标模式和常见格式问题。",
      actionLabel: "打开检查器",
      icon: CheckCircle2,
    },
  ],
  "parameter-confirmation": [
    {
      id: "parameter-generator",
      title: "AI 参数推荐",
      description: "结合工作流上下文和本地 RAG，生成 INCAR、KPOINTS 与 POTCAR 建议。",
      actionLabel: "生成建议",
      icon: Settings,
    },
    {
      id: "rag-compare",
      title: "本地 RAG 对照",
      description: "检索已验证计算案例；当前没有计算归档时会显示为空。",
      actionLabel: "查看 RAG",
      icon: Database,
    },
    {
      id: "parameter-review",
      title: "人工确认",
      description: "编辑最终参数值并完成本流程，进入计算提交。",
      actionLabel: "打开确认",
      icon: CheckCircle2,
    },
  ],
  "calculation-submit": [
    {
      id: "backend-route",
      title: "后端路由",
      description: "选择 ASE 或 SSH 集群，并确认远程工作目录。",
      actionLabel: "打开路由",
      icon: Cpu,
    },
    {
      id: "resource-budget",
      title: "资源预算",
      description: "确认任务数、墙时、启动命令和队列策略。",
      actionLabel: "打开预算",
      icon: Settings,
    },
  ],
  "result-archive": [
    {
      id: "status-refresh",
      title: "状态刷新",
      description: "刷新执行状态，查看输出摘要和错误片段。",
      actionLabel: "打开状态",
      icon: RefreshCw,
    },
    {
      id: "archive-decision",
      title: "归档决策",
      description: "决定哪些结果与参数应进入可复用知识库。",
      actionLabel: "打开归档",
      icon: History,
    },
  ],
  "structure-prep": [
    {
      id: "source-import",
      title: "结构导入器",
      description: "粘贴 POSCAR/CIF、上传文件，并确认材料来源。",
      actionLabel: "打开导入器",
      icon: FileText,
    },
    {
      id: "structure-preview",
      title: "结构预览",
      description: "查看行数、元素行、估算原子数和坐标模式。",
      actionLabel: "打开预览",
      icon: Wrench,
    },
  ],
  "poscar-validation": [
    {
      id: "poscar-check",
      title: "POSCAR 检查器",
      description: "检查元素顺序、数量行、坐标模式和常见格式问题。",
      actionLabel: "打开检查器",
      icon: CheckCircle2,
    },
    {
      id: "issue-report",
      title: "结构问题报告",
      description: "记录可疑结构或导入错误，返回流程后标记已处理。",
      actionLabel: "打开报告",
      icon: AlertTriangle,
    },
  ],
  "incar-recommendation": [
    {
      id: "incar-generator",
      title: "INCAR 推荐器",
      description: "生成控制参数建议，并保留人工覆盖入口。",
      actionLabel: "打开推荐器",
      icon: Settings,
    },
    {
      id: "rag-compare",
      title: "知识库对照",
      description: "对照已验证案例，避免重复手动查找相似设置。",
      actionLabel: "打开对照",
      icon: Database,
    },
  ],
  "kpoints-configuration": [
    {
      id: "mesh-planner",
      title: "KPOINTS 估算器",
      description: "按体系大小和计算目标规划采样策略。",
      actionLabel: "打开估算器",
      icon: Settings,
    },
    {
      id: "cost-check",
      title: "成本检查",
      description: "估算网格对计算成本和收敛风险的影响。",
      actionLabel: "打开检查",
      icon: Cpu,
    },
  ],
  "potcar-guidance": [
    {
      id: "potcar-selector",
      title: "赝势选择器",
      description: "梳理 POTCAR 族、半芯态和课题组约定。",
      actionLabel: "打开选择器",
      icon: FileText,
    },
    {
      id: "dataset-policy",
      title: "数据集约定",
      description: "记录机构或项目约束，避免混用不兼容设置。",
      actionLabel: "打开约定",
      icon: Database,
    },
  ],
  "submission-prep": [
    {
      id: "backend-route",
      title: "后端路由",
      description: "选择 ASE 或 SSH 集群，并确认远程工作目录。",
      actionLabel: "打开路由",
      icon: Cpu,
    },
    {
      id: "resource-budget",
      title: "资源预算",
      description: "确认任务数、墙时、启动命令和队列策略。",
      actionLabel: "打开预算",
      icon: Settings,
    },
  ],
  "result-review": [
    {
      id: "status-refresh",
      title: "状态刷新",
      description: "刷新执行状态，查看输出摘要和错误片段。",
      actionLabel: "打开状态",
      icon: RefreshCw,
    },
    {
      id: "archive-decision",
      title: "归档决策",
      description: "决定哪些结果与参数应进入可复用知识库。",
      actionLabel: "打开归档",
      icon: History,
    },
  ],
};

const DEFAULT_TOOLS: WorkflowTool[] = [
  {
    id: "stage-assistant",
    title: "阶段工具",
    description: "打开当前阶段的辅助工具，完成或报告问题后返回流程。",
    actionLabel: "打开工具",
    icon: Wrench,
  },
];

function stageTitle(stageKey: string, fallback?: string | null): string {
  const blueprint = getStageBlueprint(stageKey);
  return blueprint.title === stageKey ? fallback || stageKey : blueprint.title;
}

function formatStatus(status: string): string {
  const normalized = status.toLowerCase().replace(/\s+/g, "-");
  return STATUS_LABELS[normalized] ?? STATUS_LABELS[status.toLowerCase()] ?? status;
}

function formatParameterCategory(category: string | null): string {
  if (!category) {
    return "通用";
  }
  return PARAMETER_CATEGORY_LABELS[category.toLowerCase()] ?? category;
}

function serializeValue(value: JsonValue): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  return JSON.stringify(value, null, 2);
}

function parseEditorValue(value: string): JsonValue {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    return trimmed;
  }
}

function buildDraftMap(step: WorkflowStep | undefined): Record<string, string> {
  if (!step) {
    return {};
  }
  return Object.fromEntries(
    step.parameters.map((parameter) => [
      parameter.name,
      serializeValue(parameter.approved_value ?? parameter.edited_value ?? parameter.suggested_value),
    ])
  );
}

function buildDraftPayload(
  step: WorkflowStep | undefined,
  draftValues: Record<string, string>
): Record<string, JsonValue> | null {
  if (!step || step.parameters.length === 0) {
    return null;
  }

  return Object.fromEntries(
    step.parameters.map((parameter) => [
      parameter.name,
      parseEditorValue(
        draftValues[parameter.name] ??
          serializeValue(parameter.approved_value ?? parameter.edited_value ?? parameter.suggested_value)
      ),
    ])
  );
}

function updateStep(session: WorkflowSession, nextStep: WorkflowStep): WorkflowSession {
  const hasStep = session.steps.some((step) => step.id === nextStep.id);
  const nextSteps = hasStep
    ? session.steps.map((step) => (step.id === nextStep.id ? nextStep : step))
    : [...session.steps, nextStep];

  return {
    ...session,
    current_stage_key: nextStep.stage_key,
    steps: nextSteps,
  };
}

function getNextStageKey(steps: WorkflowStep[], currentStageKey: string): string {
  const ordered = [...steps].sort((left, right) => left.stage_index - right.stage_index);
  const currentIndex = ordered.findIndex((step) => step.stage_key === currentStageKey);
  if (currentIndex === -1 || currentIndex === ordered.length - 1) {
    return currentStageKey;
  }
  return ordered[currentIndex + 1]?.stage_key ?? currentStageKey;
}

function summarizeStep(step: WorkflowStep): string {
  const headline = step.recommendation_summary || `${stageTitle(step.stage_key, step.stage_name)} 建议已生成。`;
  const lines = step.parameters.slice(0, 6).map((parameter) => {
    const value = parameter.suggested_value ?? parameter.approved_value;
    return `${parameter.name}: ${serializeValue(value)} | ${parameter.rationale}`;
  });
  return `${headline}\n${lines.join("\n")}`.trim();
}

function summarizeExecution(execution: ExecutionRecord): string[] {
  const lines = [
    `执行器=${execution.executor_type.toUpperCase()}`,
    `状态=${formatStatus(execution.status)}`,
    `作业=${execution.remote_job_id ?? "无"}`,
  ];
  if (execution.output_manifest?.converged !== undefined) {
    lines.push(`已收敛=${String(execution.output_manifest.converged)}`);
  }
  if (execution.output_manifest?.energy_ev !== undefined) {
    lines.push(`能量(eV)=${String(execution.output_manifest.energy_ev)}`);
  }
  if (execution.output_manifest?.max_force_ev_per_ang !== undefined) {
    lines.push(`最大力(eV/Ang)=${String(execution.output_manifest.max_force_ev_per_ang)}`);
  }
  if (execution.output_manifest?.error) {
    lines.push(`错误=${String(execution.output_manifest.error)}`);
  }
  return lines;
}

function extractStructureSummary(text: string): {
  lineCount: number;
  atomCount: number;
  speciesLabel: string;
  coordinateMode: string;
  ready: boolean;
} {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const speciesRow = lines[5] ?? "";
  const countCandidateRows = [lines[6] ?? "", lines[5] ?? ""];
  const countRow =
    countCandidateRows.find((line) => /\d/.test(line) && !/[A-Za-z]/.test(line.replace(/\s+/g, ""))) ?? "";
  const atomCount = countRow
    .split(/\s+/)
    .map((token) => Number(token))
    .filter((token) => Number.isFinite(token))
    .reduce((total, token) => total + token, 0);

  const coordinateMode =
    lines.find((line) => /^direct$/i.test(line) || /^cartesian$/i.test(line)) ?? "未识别";

  return {
    lineCount: lines.length,
    atomCount,
    speciesLabel: speciesRow || "等待元素标签",
    coordinateMode,
    ready: lines.length >= 8,
  };
}

function previewSnapshot(snapshot: Record<string, JsonValue>): string[] {
  return Object.entries(snapshot)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${serializeValue(value)}`);
}

function parameterSourceSummary(parameter: StepParameter): string {
  const references = parameter.source_metadata?.references;
  const referenceCount = Array.isArray(references) ? references.length : 0;
  if (referenceCount > 0) {
    return `本地 RAG 引用 ${referenceCount} 个已验证案例`;
  }
  return "本地 RAG 暂无案例，来自上下文和内置启发式规则";
}

function getToolsForStage(stageKey: string): WorkflowTool[] {
  return STAGE_TOOLS[stageKey] ?? DEFAULT_TOOLS;
}

function toolKey(stageKey: string, toolId: string): string {
  return `${stageKey}:${toolId}`;
}

function isStepComplete(step: WorkflowStep | undefined): boolean {
  return Boolean(step && (DONE_STATUSES.has(step.status.toLowerCase()) || step.validated));
}

export function WorkflowWizard({ initialSession, connections }: WorkflowWizardProps) {
  const [session, setSession] = useState(initialSession);
  const [activeStageKey, setActiveStageKey] = useState(
    initialSession.current_stage_key ?? initialSession.steps[0]?.stage_key ?? "materials-prep"
  );
  const [openTool, setOpenTool] = useState<{ stageKey: string; toolId: string } | null>(null);
  const [toolResults, setToolResults] = useState<Record<string, ToolResult>>({});
  const [toolReportNote, setToolReportNote] = useState("");
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState("");
  const [approvalNote, setApprovalNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [chatMessages, setChatMessages] = useState<ConversationMessage[]>([]);
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [knowledgeMatches, setKnowledgeMatches] = useState<KnowledgeEntry[]>([]);
  const [knowledgeNote, setKnowledgeNote] = useState<string | null>(null);
  const [knowledgeRefreshTick, setKnowledgeRefreshTick] = useState(0);

  const [selectedConnectionId, setSelectedConnectionId] = useState(
    initialSession.connection_profile_id ?? connections[0]?.id ?? ""
  );
  const [executionBackend, setExecutionBackend] = useState<"ase" | "ssh">(
    connections.length > 0 ? "ssh" : "ase"
  );
  const [launchCommand, setLaunchCommand] = useState("mpirun -np 32 vasp_std");
  const [workingDirectory, setWorkingDirectory] = useState("");

  const [poscarText, setPoscarText] = useState(initialSession.structure_text ?? "");
  const [uploadedName, setUploadedName] = useState("");
  const [materialsBrief, setMaterialsBrief] = useState(initialSession.user_notes ?? "");

  const deferredPoscarText = useDeferredValue(poscarText);

  const orderedSteps = useMemo(
    () => [...session.steps].sort((left, right) => left.stage_index - right.stage_index),
    [session.steps]
  );
  const currentStep = useMemo(
    () => orderedSteps.find((step) => step.stage_key === activeStageKey),
    [activeStageKey, orderedSteps]
  );
  const progress = useMemo(() => summarizeSessionProgress(session), [session]);
  const structureSummary = useMemo(
    () => extractStructureSummary(deferredPoscarText),
    [deferredPoscarText]
  );
  const selectedConnection = useMemo(
    () => connections.find((connection) => connection.id === selectedConnectionId) ?? null,
    [connections, selectedConnectionId]
  );
  const blueprint = useMemo(() => getStageBlueprint(activeStageKey), [activeStageKey]);
  const activeTools = useMemo(() => getToolsForStage(activeStageKey), [activeStageKey]);
  const selectedTool = useMemo(() => {
    if (!openTool) {
      return null;
    }
    return getToolsForStage(openTool.stageKey).find((tool) => tool.id === openTool.toolId) ?? null;
  }, [openTool]);
  const finalReady = orderedSteps.length > 0 && orderedSteps.every((step) => isStepComplete(step));
  const isParameterStage = [
    "parameter-confirmation",
    "incar-recommendation",
    "kpoints-configuration",
    "potcar-guidance",
  ].includes(activeStageKey);
  const isCalculationStage = ["calculation-submit", "submission-prep"].includes(activeStageKey);
  const isResultStage = ["result-archive", "result-review"].includes(activeStageKey);

  useEffect(() => {
    setDraftValues(buildDraftMap(currentStep));
  }, [currentStep]);

  useEffect(() => {
    let cancelled = false;

    getExecutions(session.id)
      .then((result) => {
        if (!cancelled) {
          setExecutions(result);
        }
      })
      .catch(() => undefined);

    getChatMessages(session.id)
      .then((result) => {
        if (!cancelled) {
          setChatMessages(result);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [session.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadKnowledge() {
      try {
        const result = await searchKnowledge({
          stage_key: activeStageKey,
          calculation_type: session.calculation_type,
          material_system: session.material_system,
          task_goal: session.goal,
          top_k: 3,
        });
        if (cancelled) {
          return;
        }
        setKnowledgeMatches(result);
        setKnowledgeNote(result.length > 0 ? null : "当前阶段暂无已验证案例。");
      } catch (error) {
        if (cancelled) {
          return;
        }
        setKnowledgeMatches([]);
        setKnowledgeNote(error instanceof Error ? error.message : "知识检索当前不可用。");
      }
    }

    void loadKnowledge();

    return () => {
      cancelled = true;
    };
  }, [
    activeStageKey,
    knowledgeRefreshTick,
    session.calculation_type,
    session.goal,
    session.material_system,
  ]);

  async function appendChat(
    role: "user" | "assistant" | "system",
    content: string,
    stageKey?: string,
    stepId?: string
  ) {
    try {
      const created = await createChatMessage(session.id, {
        role,
        content,
        stage_key: stageKey ?? null,
        step_id: stepId ?? null,
      });
      setChatMessages((current) => [...current, created]);
    } catch {
      // Chat persistence should not block workflow progress.
    }
  }

  function updateDraft(parameterName: string, value: string) {
    setDraftValues((current) => ({ ...current, [parameterName]: value }));
  }

  async function handlePoscarFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const text = await file.text();
    setPoscarText(text);
    setUploadedName(file.name);
  }

  async function handleSaveMaterialsContext() {
    setBusyKey("save-materials");
    setMessage(null);
    const materialsStageKey = orderedSteps.some((step) => step.stage_key === "materials-prep")
      ? "materials-prep"
      : "structure-prep";
    try {
      const updated = await updateWorkflowSession(session.id, {
        structure_text: poscarText || null,
        user_notes: materialsBrief || null,
        current_stage_key: materialsStageKey,
      });
      setSession(updated);
      setActiveStageKey(updated.current_stage_key ?? materialsStageKey);
      await appendChat(
        "user",
        `已更新材料导入上下文${uploadedName ? `，来源文件：${uploadedName}` : ""}。`,
        materialsStageKey
      );
      await appendChat(
        "assistant",
        "材料导入已保存。可以继续打开工具检查，或生成阶段建议。",
        materialsStageKey
      );
      setMessage("材料上下文已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法保存材料上下文。");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleGenerateRecommendations(stageKey: string) {
    setBusyKey(`generate-${stageKey}`);
    setMessage(null);
    const stagePrompt = getStageBlueprint(stageKey).prompt;
    const stageStep = orderedSteps.find((step) => step.stage_key === stageKey);

    await appendChat(
      "user",
      feedback.trim() ? `${stagePrompt}\nExtra note: ${feedback}` : stagePrompt,
      stageKey,
      stageStep?.id
    );

    try {
      const nextStep = await generateRecommendations(session.id, {
        stage_key: stageKey,
        user_intent: session.goal,
        constraints: session.constraints ?? undefined,
        draft_parameters:
          activeStageKey === stageKey ? buildDraftPayload(stageStep, draftValues) ?? undefined : undefined,
        user_feedback: feedback || materialsBrief || undefined,
      });
      setSession((current) => updateStep(current, nextStep));
      setActiveStageKey(stageKey);
      setFeedback("");
      await appendChat("assistant", summarizeStep(nextStep), stageKey, nextStep.id);
      setMessage(`${stageTitle(nextStep.stage_key, nextStep.stage_name)} 建议已准备好审查。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法生成建议。");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCompleteCurrentStep() {
    if (!currentStep) {
      return;
    }

    setBusyKey(`approve-${currentStep.stage_key}`);
    setMessage(null);
    try {
      const nextStep = await approveStep(session.id, currentStep.id, {
        parameters: currentStep.parameters.map((parameter: StepParameter) => {
          const approvedValue = parseEditorValue(draftValues[parameter.name] ?? "");
          return {
            name: parameter.name,
            edited_value:
              serializeValue(parameter.suggested_value) === serializeValue(approvedValue)
                ? null
                : approvedValue,
            approved_value: approvedValue,
          };
        }),
        note: approvalNote || null,
        mark_validated: true,
      });
      const canArchiveToKnowledge = ["result-archive", "result-review"].includes(nextStep.stage_key) && executions.length > 0;
      const finalizedStep = canArchiveToKnowledge
        ? await validateStep(session.id, nextStep.id, {
            validation_note: approvalNote || "结果归档确认。",
            trust_score: 0.8,
          })
        : nextStep;
      setSession((current) => updateStep(current, finalizedStep));
      setKnowledgeRefreshTick((current) => current + 1);
      await appendChat(
        "user",
        `已完成 ${stageTitle(finalizedStep.stage_key, finalizedStep.stage_name)}。`,
        finalizedStep.stage_key,
        finalizedStep.id
      );
      await appendChat(
        "assistant",
        canArchiveToKnowledge
          ? `${stageTitle(finalizedStep.stage_key, finalizedStep.stage_name)} 已归档到本地 RAG 知识库。`
          : `${stageTitle(finalizedStep.stage_key, finalizedStep.stage_name)} 已保存为完成。计算完成并人工归档后才会进入本地 RAG 知识库。`,
        finalizedStep.stage_key,
        finalizedStep.id
      );
      setApprovalNote("");
      setActiveStageKey(getNextStageKey(orderedSteps, finalizedStep.stage_key));
      setMessage(
        canArchiveToKnowledge
          ? "该流程已完成，并已写入本地 RAG 知识库。"
          : "该流程已完成，已返回上一级流程轨道。"
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法完成该流程。");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSubmitRun() {
    if (executionBackend === "ssh" && !selectedConnectionId) {
      setMessage("使用 SSH 后端前，请先选择计算配置。");
      return;
    }

    setBusyKey("execute");
    setMessage(null);
    await appendChat(
      "user",
      `请求通过 ${executionBackend.toUpperCase()} 执行，启动命令为 ${launchCommand || "默认值"}。`,
      "calculation-submit",
      currentStep?.id
    );

    try {
      const execution = await submitExecution(session.id, {
        execution_backend: executionBackend,
        calculator_name: "vasp",
        connection_profile_id: executionBackend === "ssh" ? selectedConnectionId : null,
        launch_command: launchCommand || null,
        working_directory: workingDirectory || null,
        step_id: currentStep?.id ?? null,
      });
      setExecutions((current) => [execution, ...current]);
      if (executionBackend === "ssh" && selectedConnectionId) {
        setSession((current) => ({ ...current, connection_profile_id: selectedConnectionId }));
      }
      await appendChat(
        "assistant",
        `执行已提交。状态=${execution.status} 路径=${execution.remote_path}`,
        "calculation-submit",
        currentStep?.id
      );
      setMessage("已提交。下面可以刷新状态并查看输出。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法提交执行。");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRefreshExecution(executionId: string) {
    setBusyKey(`refresh-${executionId}`);
    try {
      const refreshed = await refreshExecution(session.id, executionId);
      setExecutions((current) =>
        current.map((item) => (item.id === refreshed.id ? refreshed : item))
      );
      await appendChat(
        "system",
        `执行 ${refreshed.id} 已刷新：状态=${refreshed.status}。`,
        "result-archive",
        currentStep?.id
      );
      setMessage(`执行 ${refreshed.id.slice(0, 8)} 已刷新。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法刷新执行状态。");
    } finally {
      setBusyKey(null);
    }
  }

  function openStageTool(toolId: string) {
    setOpenTool({ stageKey: activeStageKey, toolId });
    setToolReportNote("");
    setMessage(null);
  }

  function closeToolWithResult(result: ToolResult) {
    if (!openTool || !selectedTool) {
      return;
    }

    const key = toolKey(openTool.stageKey, openTool.toolId);
    setToolResults((current) => ({ ...current, [key]: result }));
    if (result === "reported") {
      void appendChat(
        "system",
        `${selectedTool.title} 报错：${toolReportNote.trim() || "未填写说明"}`,
        openTool.stageKey
      );
    }
    setActiveStageKey(openTool.stageKey);
    setOpenTool(null);
    setToolReportNote("");
    setMessage(
      result === "reported"
        ? `${selectedTool.title} 已记录问题并返回上一级，流程卡片已显示完成。`
        : `${selectedTool.title} 已完成并返回上一级。`
    );
  }

  function countCompletedTools(stageKey: string): number {
    return getToolsForStage(stageKey).filter((tool) => toolResults[toolKey(stageKey, tool.id)]).length;
  }

  function renderToolContent(tool: WorkflowTool) {
    if (tool.id === "source-import") {
      return (
        <div className="content-grid dashboard-grid">
          <label>
            POSCAR / CIF 来源文件
            <input type="file" accept=".vasp,.poscar,.cif,.txt,*/*" onChange={handlePoscarFile} />
          </label>
          <label>
            科研人员导入备注
            <textarea
              rows={5}
              value={materialsBrief}
              onChange={(event) => setMaterialsBrief(event.target.value)}
              placeholder="例如：来源数据库、预期氧化态、表面/体相目标、磁性顾虑。"
            />
          </label>
        </div>
      );
    }

    if (tool.id === "structure-preview" || tool.id === "poscar-check") {
      return (
        <div className="mini-grid">
          <div className="mini-metric">
            <strong>已解析行数</strong>
            <span>{structureSummary.lineCount}</span>
          </div>
          <div className="mini-metric">
            <strong>估算原子数</strong>
            <span>{structureSummary.atomCount || "未知"}</span>
          </div>
          <div className="mini-metric">
            <strong>元素行</strong>
            <span>{structureSummary.speciesLabel}</span>
          </div>
          <div className="mini-metric">
            <strong>坐标模式</strong>
            <span>{structureSummary.coordinateMode}</span>
          </div>
        </div>
      );
    }

    if (tool.id === "parameter-generator") {
      return (
        <div className="stack-list">
          <div className="mini-grid">
            <div className="mini-metric">
              <strong>本地 RAG 命中</strong>
              <span>{knowledgeMatches.length}</span>
              <p className="support-text">
                {knowledgeMatches.length > 0 ? "将作为参数推荐参考。" : "暂无已验证计算案例。"}
              </p>
            </div>
            <div className="mini-metric">
              <strong>当前参数</strong>
              <span>{currentStep?.parameters.length ?? 0}</span>
              <p className="support-text">生成后可在下方参数确认表中编辑最终值。</p>
            </div>
          </div>
          <button
            className="primary-button icon-button-label align-start"
            disabled={busyKey === `generate-${activeStageKey}`}
            onClick={() => handleGenerateRecommendations(activeStageKey)}
            type="button"
          >
            <Wrench size={16} />
            {busyKey === `generate-${activeStageKey}` ? "生成中..." : "生成 AI 参数建议"}
          </button>
          {knowledgeNote ? <p className="muted-text">{knowledgeNote}</p> : null}
        </div>
      );
    }

    if (tool.id === "rag-compare") {
      return (
        <div className="stack-list">
          {knowledgeMatches.map((entry) => (
            <article className="knowledge-card" key={entry.id}>
              <div className="inline-spread">
                <strong>{entry.material_system || "通用案例"}</strong>
                <span className="meta-label">可信度 {entry.trust_score.toFixed(2)}</span>
              </div>
              <p className="support-text">{entry.task_goal}</p>
              {previewSnapshot(entry.parameter_snapshot).map((line) => (
                <p className="meta-label" key={`${entry.id}-${line}`}>
                  {line}
                </p>
              ))}
            </article>
          ))}
          {knowledgeNote ? <p className="muted-text">{knowledgeNote}</p> : null}
        </div>
      );
    }

    if (tool.id === "parameter-review") {
      return (
        <div className="stack-list">
          {currentStep?.recommendation_summary ? (
            <div className="hint-box">
              <strong>推荐摘要</strong>
              <p className="support-text">{currentStep.recommendation_summary}</p>
            </div>
          ) : null}
          {currentStep && currentStep.parameters.length > 0 ? (
            <div className="parameter-preview-list">
              {currentStep.parameters.slice(0, 8).map((parameter) => (
                <div className="compact-stage-row" key={parameter.id}>
                  <strong>{parameter.name}</strong>
                  <p className="support-text">
                    {serializeValue(parameter.suggested_value)} · {parameter.rationale}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-text">还没有参数建议。请先生成 AI 参数建议。</p>
          )}
        </div>
      );
    }

    if (tool.id === "backend-route" || tool.id === "resource-budget") {
      return (
        <div className="compact-grid">
          <label>
            执行后端
            <select
              value={executionBackend}
              onChange={(event) => setExecutionBackend(event.target.value as "ase" | "ssh")}
            >
              <option value="ase">ASE / 本地 VASP 适配器</option>
              <option value="ssh">SSH / 调度器主机</option>
            </select>
          </label>
          <label>
            计算配置
            <select
              value={selectedConnectionId}
              onChange={(event) => setSelectedConnectionId(event.target.value)}
              disabled={executionBackend !== "ssh"}
            >
              <option value="">选择远程配置</option>
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name} ({connection.username}@{connection.host})
                </option>
              ))}
            </select>
          </label>
          <label>
            启动命令
            <input
              value={launchCommand}
              onChange={(event) => setLaunchCommand(event.target.value)}
              placeholder="例如：mpirun -np 32 vasp_std"
            />
          </label>
          <label>
            工作目录覆盖
            <input
              value={workingDirectory}
              onChange={(event) => setWorkingDirectory(event.target.value)}
              placeholder="可选自定义工作目录"
            />
          </label>
        </div>
      );
    }

    if (tool.id === "status-refresh") {
      return (
        <div className="stack-list">
          {executions.map((execution) => (
            <article className="execution-card" key={execution.id}>
              <div className="inline-spread">
                <strong>{execution.id.slice(0, 8)}</strong>
                <StatusPill status={execution.status} />
              </div>
              {summarizeExecution(execution).map((line) => (
                <p className="support-text" key={`${execution.id}-${line}`}>
                  {line}
                </p>
              ))}
              <button
                className="secondary-button icon-button-label"
                disabled={busyKey === `refresh-${execution.id}`}
                onClick={() => handleRefreshExecution(execution.id)}
                type="button"
              >
                <RefreshCw size={16} />
                {busyKey === `refresh-${execution.id}` ? "刷新中..." : "刷新状态"}
              </button>
            </article>
          ))}
          {executions.length === 0 ? <p className="muted-text">还没有执行记录。</p> : null}
        </div>
      );
    }

    return (
      <div className="mini-grid">
        <div className="mini-metric">
          <strong>阶段目标</strong>
          <p className="support-text">{getStageBlueprint(openTool?.stageKey ?? activeStageKey).intent}</p>
        </div>
        <div className="mini-metric">
          <strong>工具动作</strong>
          <p className="support-text">{tool.description}</p>
        </div>
      </div>
    );
  }

  const materialChecklist = [
    {
      label: "已附加结构来源",
      done: Boolean(poscarText.trim()),
    },
    {
      label: "已记录科研人员备注",
      done: Boolean(materialsBrief.trim() || session.goal.trim()),
    },
    {
      label: "元素 / 数量预览可用",
      done: structureSummary.atomCount > 0 || structureSummary.ready,
    },
  ];

  return (
    <section className="content-stack">
      <section className="hero compact-hero session-hero">
        <div className="hero-copy">
          <p className="eyebrow">流程工作区</p>
          <h1>{session.title}</h1>
          <p className="lede">{session.goal}</p>
          <div className="tag-row">
            <span className="tag-chip">{session.material_system || "材料待定"}</span>
            <span className="tag-chip">{formatCalculationType(session.calculation_type)}</span>
            <span className="tag-chip">当前流程：{blueprint.title}</span>
          </div>
        </div>
        <div className="hero-stats metric-grid">
          <article className="metric-card">
            <span className="metric-value">{progress.readyPercent}%</span>
            <span className="metric-label">流程完成度</span>
          </article>
          <article className="metric-card">
            <span className="metric-value">{progress.validated}</span>
            <span className="metric-label">已确认步骤</span>
          </article>
          <article className="metric-card">
            <span className="metric-value">{executions.length}</span>
            <span className="metric-label">提交记录</span>
          </article>
          <article className="metric-card">
            <span className="metric-value">{connections.length}</span>
            <span className="metric-label">可用连接</span>
          </article>
        </div>
      </section>

      {message ? <p className="panel inline-message">{message}</p> : null}

      <section className="workflow-layout">
        <aside className="panel side-panel process-sidebar">
          <div className="panel-header">
            <div>
              <p className="eyebrow">上一级流程</p>
              <h2>步骤轨道</h2>
            </div>
            <StatusPill status={session.status} />
          </div>
          <div className="stage-list">
            {orderedSteps.map((step) => {
              const tools = getToolsForStage(step.stage_key);
              const completedCount = countCompletedTools(step.stage_key);
              const stepDone = isStepComplete(step);
              return (
                <button
                  className={`stage-card process-step-card ${
                    activeStageKey === step.stage_key && !openTool ? "selected-card" : ""
                  } ${stepDone ? "check-complete" : ""}`}
                  key={step.id}
                  onClick={() => {
                    setActiveStageKey(step.stage_key);
                    setOpenTool(null);
                  }}
                  type="button"
                >
                  <div className="inline-spread">
                    <span className="stage-index">{step.stage_index + 1}</span>
                    <StatusPill status={stepDone ? "completed" : step.status} />
                  </div>
                  <strong>{stageTitle(step.stage_key, step.stage_name)}</strong>
                  <p className="support-text">{getStageBlueprint(step.stage_key).intent}</p>
                  <span className="meta-label">
                    工具 {completedCount}/{tools.length} 已处理
                  </span>
                </button>
              );
            })}
          </div>
          <div className="divider" />
          <Link className="secondary-link icon-button-label" href="/sessions">
            <ArrowLeft size={16} />
            返回工作条目
          </Link>
        </aside>

        <div className="content-stack">
          {openTool && selectedTool ? (
            <section className="panel form-grid tool-workspace">
              <button
                className="secondary-button icon-button-label align-start"
                onClick={() => setOpenTool(null)}
                type="button"
              >
                <ArrowLeft size={16} />
                返回上一级
              </button>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">已打开工具</p>
                  <h2>{selectedTool.title}</h2>
                </div>
                <selectedTool.icon size={28} />
              </div>
              <p className="support-text">{selectedTool.description}</p>
              {renderToolContent(selectedTool)}
              <label>
                报错说明
                <textarea
                  rows={3}
                  value={toolReportNote}
                  onChange={(event) => setToolReportNote(event.target.value)}
                  placeholder="如发现输入、参数或后端配置问题，在这里记录。"
                />
              </label>
              <div className="inline-actions">
                <button
                  className="primary-button icon-button-label"
                  onClick={() => closeToolWithResult("done")}
                  type="button"
                >
                  <CheckCircle2 size={16} />
                  完成并返回
                </button>
                <button
                  className="secondary-button icon-button-label"
                  onClick={() => closeToolWithResult("reported")}
                  type="button"
                >
                  <AlertTriangle size={16} />
                  报错并返回
                </button>
              </div>
            </section>
          ) : (
            <>
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">当前流程</p>
                    <h2>{blueprint.title}</h2>
                  </div>
                  {currentStep ? <StatusPill status={isStepComplete(currentStep) ? "completed" : currentStep.status} /> : null}
                </div>
                <div className="mini-grid">
                  <div className="mini-metric">
                    <strong>阶段目标</strong>
                    <p className="support-text">{blueprint.intent}</p>
                  </div>
                  <div className="mini-metric">
                    <strong>AI 负责</strong>
                    <p className="support-text">{blueprint.aiAction}</p>
                  </div>
                  <div className="mini-metric">
                    <strong>人工确认</strong>
                    <p className="support-text">{blueprint.humanAction}</p>
                  </div>
                  <div className="mini-metric">
                    <strong>工具完成</strong>
                    <p className="support-text">
                      {countCompletedTools(activeStageKey)}/{activeTools.length} 个工具已返回上一级
                    </p>
                  </div>
                </div>
              </section>

              <section className="tool-grid">
                {activeTools.map((tool) => {
                  const result = toolResults[toolKey(activeStageKey, tool.id)];
                  const ToolIcon = tool.icon;
                  return (
                    <article className={`tool-card ${result ? "check-complete" : ""}`} key={tool.id}>
                      <div className="tool-card-icon">
                        <ToolIcon size={22} />
                      </div>
                      <div>
                        <div className="inline-spread">
                          <strong>{tool.title}</strong>
                          <span className={`status-pill ${result ? "status-completed" : ""}`}>
                            {result ? "已完成" : "待打开"}
                          </span>
                        </div>
                        <p className="support-text">{tool.description}</p>
                        {result === "reported" ? (
                          <p className="warning-text">已记录报错。</p>
                        ) : null}
                      </div>
                      <button
                        className="secondary-button icon-button-label"
                        onClick={() => openStageTool(tool.id)}
                        type="button"
                      >
                        <Play size={16} />
                        {tool.actionLabel}
                      </button>
                    </article>
                  );
                })}
              </section>

              {activeStageKey === "materials-prep" || activeStageKey === "structure-prep" ? (
                <section className="content-grid dashboard-grid">
                  <article className="panel form-grid">
                    <div className="panel-header">
                      <div>
                        <p className="eyebrow">材料输入</p>
                        <h2>结构文本</h2>
                      </div>
                    </div>
                    <label>
                      POSCAR / CIF / 结构文本
                      <textarea
                        rows={10}
                        value={poscarText}
                        onChange={(event) => setPoscarText(event.target.value)}
                        placeholder="在这里粘贴 POSCAR、CIF 片段或已规范化结构文本。"
                      />
                    </label>
                    <button
                      className="primary-button icon-button-label"
                      disabled={busyKey === "save-materials"}
                      onClick={handleSaveMaterialsContext}
                      type="button"
                    >
                      <CheckCircle2 size={16} />
                      {busyKey === "save-materials" ? "保存中..." : "保存材料上下文"}
                    </button>
                    {uploadedName ? <p className="meta-label">已加载文件：{uploadedName}</p> : null}
                  </article>

                  <article className="panel">
                    <div className="panel-header">
                      <div>
                        <p className="eyebrow">检查清单</p>
                        <h2>准备状态</h2>
                      </div>
                    </div>
                    <div className="checklist">
                      {materialChecklist.map((item) => (
                        <div className={`checklist-item ${item.done ? "check-complete" : ""}`} key={item.label}>
                          <span className="check-indicator">{item.done ? "通过" : "待补"}</span>
                          <div>
                            <strong>{item.label}</strong>
                            <p className="support-text">
                              {item.done ? "已记录到当前流程。" : "仍在等待输入。"}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                </section>
              ) : null}

              <section className="panel form-grid">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">{isParameterStage ? "参数确认" : "流程确认"}</p>
                    <h2>{isParameterStage ? "AI 推荐参数与人工确认" : "生成建议并完成本步骤"}</h2>
                  </div>
                  {currentStep ? <StatusPill status={currentStep.status} /> : null}
                </div>

                {isParameterStage ? (
                  <div className="hint-box">
                    <strong>本地 RAG</strong>
                    <p className="support-text">
                      {knowledgeMatches.length > 0
                        ? `已命中 ${knowledgeMatches.length} 个本地已验证案例，AI 推荐会引用这些案例。`
                        : "本地 RAG 暂无已验证计算案例；当前推荐会先使用工作流上下文和内置 VASP 启发式规则。"}
                    </p>
                  </div>
                ) : null}

                <label>
                  给智能体的提示备注
                  <textarea
                    rows={3}
                    value={feedback}
                    onChange={(event) => setFeedback(event.target.value)}
                    placeholder="例如：使用保守收敛设置，预期强关联氧化物行为，并考虑 MLIP 预弛豫。"
                  />
                </label>

                <div className="inline-actions">
                  <button
                    className="secondary-button icon-button-label"
                    type="button"
                    onClick={() => handleGenerateRecommendations(activeStageKey)}
                    disabled={busyKey === `generate-${activeStageKey}`}
                  >
                    <Wrench size={16} />
                    {busyKey === `generate-${activeStageKey}` ? "生成中..." : isParameterStage ? "生成 AI 参数建议" : "生成建议"}
                  </button>
                  <button
                    className="primary-button icon-button-label"
                    disabled={!currentStep || busyKey === `approve-${activeStageKey}`}
                    onClick={handleCompleteCurrentStep}
                    type="button"
                  >
                    <CheckCircle2 size={16} />
                    {busyKey === `approve-${activeStageKey}` ? "完成中..." : isParameterStage ? "确认参数" : "完成本流程"}
                  </button>
                </div>

                {currentStep?.recommendation_summary ? (
                  <div className="hint-box">
                    <strong>推荐摘要</strong>
                    <p className="support-text">{currentStep.recommendation_summary}</p>
                  </div>
                ) : null}

                {currentStep && currentStep.parameters.length > 0 ? (
                  <div className="parameter-table">
                    <div className="parameter-table-head">
                      <span>参数</span>
                      <span>AI 建议</span>
                      <span>最终值</span>
                    </div>
                    {currentStep.parameters.map((parameter) => (
                      <div className="parameter-row" key={parameter.id}>
                        <div>
                          <strong>{parameter.name}</strong>
                          <p className="meta-label">{formatParameterCategory(parameter.category)}</p>
                        </div>
                        <div className="parameter-cell">
                          <pre>{serializeValue(parameter.suggested_value)}</pre>
                          <p className="support-text">{parameter.rationale}</p>
                          <p className="meta-label">{parameterSourceSummary(parameter)}</p>
                          {parameter.uncertainty_note ? (
                            <p className="warning-text">{parameter.uncertainty_note}</p>
                          ) : null}
                        </div>
                        <div className="parameter-cell">
                          <textarea
                            rows={3}
                            value={draftValues[parameter.name] ?? ""}
                            onChange={(event) => updateDraft(parameter.name, event.target.value)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted-text">
                    {isParameterStage
                      ? "参数确认尚未生成建议。点击“生成 AI 参数建议”后，系统会先查本地 RAG；当前没有计算归档时会返回空案例。"
                      : "该流程尚未生成参数。需要时先生成建议，再点击完成本流程。"}
                  </p>
                )}

                <label>
                  完成备注
                  <textarea
                    rows={2}
                    value={approvalNote}
                    onChange={(event) => setApprovalNote(event.target.value)}
                    placeholder="说明你为什么接受、编辑或完成此流程。"
                  />
                </label>
              </section>

              {isCalculationStage ? (
              <section className="panel form-grid">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">最后一步</p>
                    <h2>提交计算</h2>
                  </div>
                  <span className={`status-pill ${finalReady ? "status-completed" : ""}`}>
                    {finalReady ? "流程已完成" : "可随时提交"}
                  </span>
                </div>
                <div className="compact-grid">
                  <label>
                    执行后端
                    <select
                      value={executionBackend}
                      onChange={(event) => setExecutionBackend(event.target.value as "ase" | "ssh")}
                    >
                      <option value="ase">ASE / 本地 VASP 适配器</option>
                      <option value="ssh">SSH / 调度器主机</option>
                    </select>
                  </label>
                  <label>
                    计算配置
                    <select
                      value={selectedConnectionId}
                      onChange={(event) => setSelectedConnectionId(event.target.value)}
                      disabled={executionBackend !== "ssh"}
                    >
                      <option value="">选择远程配置</option>
                      {connections.map((connection) => (
                        <option key={connection.id} value={connection.id}>
                          {connection.name} ({connection.username}@{connection.host})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    启动命令
                    <input
                      value={launchCommand}
                      onChange={(event) => setLaunchCommand(event.target.value)}
                      placeholder="例如：mpirun -np 32 vasp_std"
                    />
                  </label>
                  <label>
                    工作目录覆盖
                    <input
                      value={workingDirectory}
                      onChange={(event) => setWorkingDirectory(event.target.value)}
                      placeholder="可选自定义工作目录"
                    />
                  </label>
                </div>
                <div className="hint-box">
                  <strong>当前路由</strong>
                  <p className="support-text">
                    {executionBackend === "ase"
                      ? "将通过 ASE/VASP 执行路径提交。"
                      : selectedConnection
                        ? `将使用 ${formatSchedulerType(selectedConnection.scheduler_type)} 连接到 ${selectedConnection.name}。`
                        : "提交远程作业前请选择 SSH 连接配置。"}
                  </p>
                </div>
                <button
                  className="primary-button icon-button-label"
                  disabled={busyKey === "execute"}
                  onClick={handleSubmitRun}
                  type="button"
                >
                  <Send size={16} />
                  {busyKey === "execute" ? "提交中..." : "提交"}
                </button>
              </section>
              ) : null}

              {isResultStage ? (
              <section className="content-grid dashboard-grid">
                <article className="panel">
                  <div className="panel-header">
                    <div>
                      <p className="eyebrow">提交记录</p>
                      <h2>状态与输出</h2>
                    </div>
                  </div>
                  <div className="stack-list">
                    {executions.slice(0, 3).map((execution) => (
                      <article className="execution-card" key={execution.id}>
                        <div className="inline-spread">
                          <strong>{execution.id.slice(0, 8)}</strong>
                          <StatusPill status={execution.status} />
                        </div>
                        {summarizeExecution(execution).map((line) => (
                          <p className="support-text" key={`${execution.id}-${line}`}>
                            {line}
                          </p>
                        ))}
                        {execution.stdout_excerpt ? <pre>{execution.stdout_excerpt}</pre> : null}
                        {execution.stderr_excerpt ? <pre>{execution.stderr_excerpt}</pre> : null}
                      </article>
                    ))}
                    {executions.length === 0 ? <p className="muted-text">还没有提交执行。</p> : null}
                  </div>
                </article>

                <article className="panel">
                  <div className="panel-header">
                    <div>
                      <p className="eyebrow">记录</p>
                      <h2>最近对话</h2>
                    </div>
                  </div>
                  <div className="stack-list">
                    {chatMessages.slice(-3).map((item) => (
                      <article className={`chat-card role-${item.role}`} key={item.id}>
                        <div className="inline-spread">
                          <strong>{ROLE_LABELS[item.role]}</strong>
                          <span className="meta-label">{new Date(item.created_at).toLocaleString()}</span>
                        </div>
                        <pre>{item.content}</pre>
                      </article>
                    ))}
                    {chatMessages.length === 0 ? <p className="muted-text">还没有对话记录。</p> : null}
                  </div>
                </article>
              </section>
              ) : null}
            </>
          )}
        </div>
      </section>
    </section>
  );
}
