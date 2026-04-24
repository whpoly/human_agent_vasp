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
import { getStageBlueprint, summarizeSessionProgress } from "@/lib/studio";
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

const STUDIO_TABS = [
  { id: "mission", label: "Mission Control" },
  { id: "materials", label: "Materials Lab" },
  { id: "parameters", label: "Parameter Copilot" },
  { id: "execution", label: "Execution + MLIP" },
  { id: "history", label: "History" },
] as const;

const MLIP_MODELS = ["MACE-medium", "CHGNet", "MatGL", "SevenNet"] as const;
const MLIP_TRAJECTORIES = ["quick-relax", "scan", "barrier-preview"] as const;

type StudioTab = (typeof STUDIO_TABS)[number]["id"];

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

function summarizeStep(step: WorkflowStep): string {
  const headline = step.recommendation_summary || `${step.stage_name} recommendation ready.`;
  const lines = step.parameters.slice(0, 6).map((parameter) => {
    const value = parameter.suggested_value ?? parameter.approved_value;
    return `${parameter.name}: ${serializeValue(value)} | ${parameter.rationale}`;
  });
  return `${headline}\n${lines.join("\n")}`.trim();
}

function summarizeExecution(execution: ExecutionRecord): string[] {
  const lines = [
    `executor=${execution.executor_type}`,
    `status=${execution.status}`,
    `job=${execution.remote_job_id ?? "n/a"}`,
  ];
  if (execution.output_manifest?.converged !== undefined) {
    lines.push(`converged=${String(execution.output_manifest.converged)}`);
  }
  if (execution.output_manifest?.energy_ev !== undefined) {
    lines.push(`energy(eV)=${String(execution.output_manifest.energy_ev)}`);
  }
  if (execution.output_manifest?.max_force_ev_per_ang !== undefined) {
    lines.push(`max_force(eV/Ang)=${String(execution.output_manifest.max_force_ev_per_ang)}`);
  }
  if (execution.output_manifest?.error) {
    lines.push(`error=${String(execution.output_manifest.error)}`);
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
    lines.find((line) => /^direct$/i.test(line) || /^cartesian$/i.test(line)) ?? "Undetected";

  return {
    lineCount: lines.length,
    atomCount,
    speciesLabel: speciesRow || "Awaiting species labels",
    coordinateMode,
    ready: lines.length >= 8,
  };
}

function previewSnapshot(snapshot: Record<string, JsonValue>): string[] {
  return Object.entries(snapshot)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${serializeValue(value)}`);
}

function getNextStageKey(steps: WorkflowStep[], currentStageKey: string): string {
  const ordered = [...steps].sort((left, right) => left.stage_index - right.stage_index);
  const currentIndex = ordered.findIndex((step) => step.stage_key === currentStageKey);
  if (currentIndex === -1 || currentIndex === ordered.length - 1) {
    return currentStageKey;
  }
  return ordered[currentIndex + 1]?.stage_key ?? currentStageKey;
}

function buildTrajectorySeries(model: string, mode: string, atomCount: number): Array<{ step: number; energy: number }> {
  const baseSeries =
    mode === "scan"
      ? [-8.4, -9.2, -10.1, -10.4, -10.0, -9.6]
      : mode === "barrier-preview"
        ? [-7.9, -8.6, -8.1, -9.2, -9.6, -10.0]
        : [-8.2, -9.1, -9.8, -10.3, -10.7, -10.9];

  const modelOffset =
    model === "CHGNet" ? 0.2 : model === "MatGL" ? 0.35 : model === "SevenNet" ? 0.55 : 0;
  const atomOffset = atomCount > 0 ? Math.min(atomCount, 60) * 0.015 : 0.12;

  return baseSeries.map((energy, index) => ({
    step: index,
    energy: Number((energy - modelOffset - atomOffset).toFixed(2)),
  }));
}

export function WorkflowWizard({ initialSession, connections }: WorkflowWizardProps) {
  const [session, setSession] = useState(initialSession);
  const [activeTab, setActiveTab] = useState<StudioTab>("mission");
  const [activeStageKey, setActiveStageKey] = useState(
    initialSession.current_stage_key ?? initialSession.steps[0]?.stage_key ?? "structure-prep"
  );
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
  const [mlipModel, setMlipModel] = useState<(typeof MLIP_MODELS)[number]>("MACE-medium");
  const [mlipTrajectory, setMlipTrajectory] = useState<(typeof MLIP_TRAJECTORIES)[number]>("quick-relax");

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
  const trajectorySeries = useMemo(
    () => buildTrajectorySeries(mlipModel, mlipTrajectory, structureSummary.atomCount),
    [mlipModel, mlipTrajectory, structureSummary.atomCount]
  );

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
          top_k: 5,
        });
        if (cancelled) {
          return;
        }
        setKnowledgeMatches(result);
        setKnowledgeNote(
          result.length > 0
            ? null
            : "No validated examples found yet for this stage. The library will populate as you validate more sessions."
        );
      } catch (error) {
        if (cancelled) {
          return;
        }
        setKnowledgeMatches([]);
        setKnowledgeNote(
          error instanceof Error ? error.message : "Knowledge retrieval is unavailable right now."
        );
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
      // Chat persistence should not block the workflow shell.
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
    try {
      const updated = await updateWorkflowSession(session.id, {
        structure_text: poscarText || null,
        user_notes: materialsBrief || null,
        current_stage_key: "structure-prep",
      });
      setSession(updated);
      setActiveStageKey(updated.current_stage_key ?? "structure-prep");
      await appendChat(
        "user",
        `Updated the material intake context${uploadedName ? ` using ${uploadedName}` : ""}.`,
        "structure-prep"
      );
      await appendChat(
        "assistant",
        "Material intake saved. The workflow is ready for validation, preprocessing, and parameter recommendation.",
        "structure-prep"
      );
      setMessage("Material intake saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save the material context.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleGenerateRecommendations(stageKey: string) {
    setBusyKey(`generate-${stageKey}`);
    setMessage(null);
    setActiveTab("parameters");
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
      setMessage(`${nextStep.stage_name} recommendation is ready for review.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to generate recommendations.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleApproveCurrentStep(markValidated: boolean) {
    if (!currentStep) {
      return;
    }

    setBusyKey(`approve-${currentStep.stage_key}-${markValidated ? "validated" : "draft"}`);
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
        mark_validated: markValidated,
      });
      setSession((current) => updateStep(current, nextStep));
      setKnowledgeRefreshTick((current) => current + 1);
      await appendChat(
        "user",
        `${markValidated ? "Approved and validated" : "Approved"} ${nextStep.stage_name}.`,
        nextStep.stage_key,
        nextStep.id
      );
      await appendChat(
        "assistant",
        `${nextStep.stage_name} stored${markValidated ? " and promoted into the parameter library" : ""}.`,
        nextStep.stage_key,
        nextStep.id
      );
      setApprovalNote("");
      setActiveStageKey(getNextStageKey(orderedSteps, nextStep.stage_key));
      setMessage(
        markValidated
          ? "Approved and validated into the parameter library."
          : "Approved values saved."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to approve this stage.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleValidateCurrentStep() {
    if (!currentStep) {
      return;
    }

    setBusyKey(`validate-${currentStep.stage_key}`);
    setMessage(null);
    try {
      const nextStep = await validateStep(session.id, currentStep.id, {
        validation_note: approvalNote || "Validated from DFT Agent Studio.",
        trust_score: 0.85,
      });
      setSession((current) => updateStep(current, nextStep));
      setKnowledgeRefreshTick((current) => current + 1);
      await appendChat(
        "assistant",
        `${nextStep.stage_name} was promoted into the reusable parameter library.`,
        nextStep.stage_key,
        nextStep.id
      );
      setMessage("Current stage validated into the parameter library.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to validate this stage.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSubmitRun() {
    if (executionBackend === "ssh" && !selectedConnectionId) {
      setMessage("Choose a compute profile before using the SSH backend.");
      return;
    }

    setBusyKey("execute");
    setMessage(null);
    await appendChat(
      "user",
      `Request execution through ${executionBackend.toUpperCase()} with launch command ${launchCommand || "default"}.`,
      "submission-prep",
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
        `Execution submitted. status=${execution.status} path=${execution.remote_path}`,
        "submission-prep",
        currentStep?.id
      );
      startTransition(() => setActiveTab("history"));
      setMessage("Execution submitted. Check the history tab for status refresh and outputs.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to submit execution.");
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
        `Execution ${refreshed.id} refreshed: status=${refreshed.status}.`,
        "result-review",
        currentStep?.id
      );
      setMessage(`Execution ${refreshed.id.slice(0, 8)} refreshed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to refresh execution.");
    } finally {
      setBusyKey(null);
    }
  }

  const materialChecklist = [
    {
      label: "Structure source attached",
      done: Boolean(poscarText.trim()),
    },
    {
      label: "Scientist notes captured",
      done: Boolean(materialsBrief.trim() || session.goal.trim()),
    },
    {
      label: "Species / count preview available",
      done: structureSummary.atomCount > 0 || structureSummary.ready,
    },
    {
      label: "Ready for AI recommendation",
      done: Boolean(poscarText.trim()) || Boolean(session.material_system),
    },
  ];

  const trajectoryMin = Math.min(...trajectorySeries.map((point) => point.energy));
  const trajectoryMax = Math.max(...trajectorySeries.map((point) => point.energy));
  const trajectorySpread = Math.max(trajectoryMax - trajectoryMin, 0.01);
  const trajectoryPolyline = trajectorySeries
    .map((point, index) => {
      const x = 32 + index * 52;
      const y = 145 - ((point.energy - trajectoryMin) / trajectorySpread) * 85;
      return `${x},${y}`;
    })
    .join(" ");
  const recentRevisions = (currentStep?.revisions ?? []).slice(-3).reverse();
  const currentWarnings = currentStep?.warnings ?? [];
  const currentContextSnapshot = currentStep?.context_snapshot ?? null;

  return (
    <section className="content-stack">
      <section className="hero compact-hero session-hero">
        <div className="hero-copy">
          <p className="eyebrow">Session workspace</p>
          <h1>{session.title}</h1>
          <p className="lede">{session.goal}</p>
          <div className="tag-row">
            <span className="tag-chip">{session.material_system || "Material TBD"}</span>
            <span className="tag-chip">{session.calculation_type}</span>
            <span className="tag-chip">Active stage: {blueprint.title}</span>
          </div>
        </div>
        <div className="hero-stats metric-grid">
          <article className="metric-card">
            <span className="metric-value">{progress.readyPercent}%</span>
            <span className="metric-label">Stage approval progress</span>
          </article>
          <article className="metric-card">
            <span className="metric-value">{progress.validated}</span>
            <span className="metric-label">Validated library steps</span>
          </article>
          <article className="metric-card">
            <span className="metric-value">{executions.length}</span>
            <span className="metric-label">Execution records</span>
          </article>
          <article className="metric-card">
            <span className="metric-value">{connections.length}</span>
            <span className="metric-label">Available compute links</span>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Workspace navigation</p>
            <h2>DFT Agent Studio</h2>
          </div>
          <StatusPill status={session.status} />
        </div>
        <div className="tab-strip">
          {STUDIO_TABS.map((tab) => (
            <button
              className={`tab-pill ${activeTab === tab.id ? "selected-tab" : ""}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
          <Link className="secondary-link" href="/connections">
            Compute settings
          </Link>
        </div>
        {message ? <p className="inline-message">{message}</p> : null}
      </section>

      {activeTab === "mission" ? (
        <section className="workflow-layout">
          <div className="panel side-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Workflow map</p>
                <h2>Stage rail</h2>
              </div>
            </div>
            <div className="stage-list">
              {orderedSteps.map((step) => (
                <button
                  className={`stage-card ${activeStageKey === step.stage_key ? "selected-card" : ""}`}
                  key={step.id}
                  onClick={() => {
                    setActiveStageKey(step.stage_key);
                    setActiveTab("parameters");
                  }}
                  type="button"
                >
                  <div className="inline-spread">
                    <span className="stage-index">{step.stage_index + 1}</span>
                    <StatusPill status={step.status} />
                  </div>
                  <strong>{step.stage_name}</strong>
                  <p className="support-text">{getStageBlueprint(step.stage_key).intent}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="content-stack">
            <section className="content-grid dashboard-grid">
              <article className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Operating model</p>
                    <h2>AI + scientist collaboration</h2>
                  </div>
                </div>
                <div className="mini-grid">
                  <div className="mini-metric">
                    <strong>AI does</strong>
                    <p className="support-text">{blueprint.aiAction}</p>
                  </div>
                  <div className="mini-metric">
                    <strong>Scientist does</strong>
                    <p className="support-text">{blueprint.humanAction}</p>
                  </div>
                  <div className="mini-metric">
                    <strong>Current intent</strong>
                    <p className="support-text">{blueprint.intent}</p>
                  </div>
                  <div className="mini-metric">
                    <strong>Suggested next move</strong>
                    <p className="support-text">
                      Open the Parameter Copilot tab to generate or review the active stage.
                    </p>
                  </div>
                </div>
              </article>

              <article className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Framework scope</p>
                    <h2>What this shell now supports</h2>
                  </div>
                </div>
                <div className="stack-list">
                  <article className="capability-card">
                    <strong>Materials intake and preprocessing</strong>
                    <p className="support-text">
                      POSCAR upload, scientist notes, AI-ready structure context, and preprocessing placeholders.
                    </p>
                  </article>
                  <article className="capability-card">
                    <strong>DFT parameter recommendation and library capture</strong>
                    <p className="support-text">
                      Stage-based recommendation, editable approval, and validated knowledge retrieval.
                    </p>
                  </article>
                  <article className="capability-card">
                    <strong>Backend routing and MLIP scout lane</strong>
                    <p className="support-text">
                      ASE or SSH execution routes plus a front-end placeholder for future MLIP calculators and trajectory previews.
                    </p>
                  </article>
                </div>
              </article>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Session brief</p>
                  <h2>Scientist context</h2>
                </div>
              </div>
              <div className="meta-grid">
                <div className="mini-metric">
                  <strong>Material system</strong>
                  <span>{session.material_system || "Not specified yet"}</span>
                </div>
                <div className="mini-metric">
                  <strong>Calculation type</strong>
                  <span>{session.calculation_type}</span>
                </div>
                <div className="mini-metric">
                  <strong>Stored notes</strong>
                  <span>{session.user_notes || "No scientist notes yet"}</span>
                </div>
                <div className="mini-metric">
                  <strong>Connected compute target</strong>
                  <span>
                    {selectedConnection
                      ? `${selectedConnection.name} (${selectedConnection.scheduler_type})`
                      : "Not chosen yet"}
                  </span>
                </div>
              </div>
            </section>
          </div>
        </section>
      ) : null}

      {activeTab === "materials" ? (
        <section className="content-stack">
          <section className="content-grid dashboard-grid">
            <article className="panel form-grid">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Intake</p>
                  <h2>Material acquisition</h2>
                </div>
              </div>
              <label>
                POSCAR / CIF source file
                <input type="file" accept=".vasp,.poscar,.cif,.txt,*/*" onChange={handlePoscarFile} />
              </label>
              <label>
                Structure text
                <textarea
                  rows={12}
                  value={poscarText}
                  onChange={(event) => setPoscarText(event.target.value)}
                  placeholder="Paste POSCAR, CIF excerpt, or normalized structure text here."
                />
              </label>
              <label>
                Scientist intake notes
                <textarea
                  rows={4}
                  value={materialsBrief}
                  onChange={(event) => setMaterialsBrief(event.target.value)}
                  placeholder="Examples: source database, expected oxidation state, slab/bulk intent, magnetic concerns."
                />
              </label>
              <div className="inline-actions">
                <button
                  className="primary-button"
                  disabled={busyKey === "save-materials"}
                  onClick={handleSaveMaterialsContext}
                  type="button"
                >
                  {busyKey === "save-materials" ? "Saving..." : "Save material context"}
                </button>
                <button
                  className="secondary-button"
                  onClick={() => handleGenerateRecommendations("poscar-validation")}
                  type="button"
                  disabled={busyKey === "generate-poscar-validation"}
                >
                  {busyKey === "generate-poscar-validation" ? "Generating..." : "Ask AI to validate structure"}
                </button>
              </div>
              {uploadedName ? <p className="meta-label">Loaded file: {uploadedName}</p> : null}
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Preflight</p>
                  <h2>Preprocessing checklist</h2>
                </div>
              </div>
              <div className="checklist">
                {materialChecklist.map((item) => (
                  <div className={`checklist-item ${item.done ? "check-complete" : ""}`} key={item.label}>
                    <span className="check-indicator">{item.done ? "OK" : "..."}</span>
                    <div>
                      <strong>{item.label}</strong>
                      <p className="support-text">
                        {item.done
                          ? "Captured in the current session context."
                          : "Still waiting for more structure or scientist input."}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hint-box">
                <strong>Suggested future additions</strong>
                <p className="support-text">
                  This area is ready for symmetry detection, oxidation-state guesses, magnetic-site hints,
                  supercell generation, and dataset connectors like Materials Project or OQMD.
                </p>
              </div>
            </article>
          </section>

          <section className="content-grid dashboard-grid">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Visual lab</p>
                  <h2>Structure preview placeholder</h2>
                </div>
              </div>
              <div className="structure-preview">
                <svg className="structure-canvas" viewBox="0 0 360 220" role="img" aria-label="Structure preview placeholder">
                  <rect x="32" y="28" width="220" height="150" rx="18" className="structure-frame" />
                  <rect x="110" y="60" width="220" height="150" rx="18" className="structure-frame structure-frame-ghost" />
                  {Array.from({ length: Math.max(5, Math.min(10, structureSummary.atomCount || 6)) }).map((_, index) => {
                    const x = 72 + (index % 4) * 56 + (index > 3 ? 20 : 0);
                    const y = 72 + Math.floor(index / 4) * 44;
                    return <circle cx={x} cy={y} key={`${x}-${y}`} r="9" className="structure-atom" />;
                  })}
                  <line x1="32" y1="28" x2="110" y2="60" className="structure-edge" />
                  <line x1="252" y1="28" x2="330" y2="60" className="structure-edge" />
                  <line x1="252" y1="178" x2="330" y2="210" className="structure-edge" />
                  <line x1="32" y1="178" x2="110" y2="210" className="structure-edge" />
                </svg>
                <div className="mini-grid">
                  <div className="mini-metric">
                    <strong>Parsed lines</strong>
                    <span>{structureSummary.lineCount}</span>
                  </div>
                  <div className="mini-metric">
                    <strong>Estimated atoms</strong>
                    <span>{structureSummary.atomCount || "Unknown"}</span>
                  </div>
                  <div className="mini-metric">
                    <strong>Species row</strong>
                    <span>{structureSummary.speciesLabel}</span>
                  </div>
                  <div className="mini-metric">
                    <strong>Coordinate mode</strong>
                    <span>{structureSummary.coordinateMode}</span>
                  </div>
                </div>
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Planned connectors</p>
                  <h2>AI-assisted intake roadmap</h2>
                </div>
              </div>
              <div className="stack-list">
                <article className="capability-card">
                  <strong>Database fetchers</strong>
                  <p className="support-text">
                    Reserve this section for Materials Project, OQMD, NOMAD, or internal CIF/POSCAR repositories.
                  </p>
                </article>
                <article className="capability-card">
                  <strong>Manual + AI dual mode</strong>
                  <p className="support-text">
                    Every AI suggestion should stay editable, with provenance and a scientist confirmation step.
                  </p>
                </article>
                <article className="capability-card">
                  <strong>Preprocess queue</strong>
                  <p className="support-text">
                    Ready to host structure standardization, magmom seeding, supercell suggestions, and defect builders.
                  </p>
                </article>
              </div>
            </article>
          </section>
        </section>
      ) : null}

      {activeTab === "parameters" ? (
        <section className="workflow-layout">
          <div className="panel side-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Stages</p>
                <h2>Parameter workflow</h2>
              </div>
            </div>
            <div className="stage-list">
              {orderedSteps.map((step) => (
                <button
                  className={`stage-card ${activeStageKey === step.stage_key ? "selected-card" : ""}`}
                  key={step.id}
                  onClick={() => setActiveStageKey(step.stage_key)}
                  type="button"
                >
                  <div className="inline-spread">
                    <strong>{step.stage_name}</strong>
                    <StatusPill status={step.status} />
                  </div>
                  <p className="support-text">{getStageBlueprint(step.stage_key).intent}</p>
                </button>
              ))}
            </div>

            <div className="divider" />

            <div className="panel-subsection">
              <p className="eyebrow">Retrieved cases</p>
              <h3>Knowledge snapshots</h3>
              <div className="stack-list">
                {knowledgeMatches.map((entry) => (
                  <article className="knowledge-card" key={entry.id}>
                    <div className="inline-spread">
                      <strong>{entry.material_system || "Generic case"}</strong>
                      <span className="meta-label">trust {entry.trust_score.toFixed(2)}</span>
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
            </div>
          </div>

          <div className="content-stack">
            <section className="panel form-grid">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Active stage</p>
                  <h2>{blueprint.title}</h2>
                </div>
                {currentStep ? <StatusPill status={currentStep.status} /> : null}
              </div>

              <div className="mini-grid">
                <div className="mini-metric">
                  <strong>Stage intent</strong>
                  <p className="support-text">{blueprint.intent}</p>
                </div>
                <div className="mini-metric">
                  <strong>AI role</strong>
                  <p className="support-text">{blueprint.aiAction}</p>
                </div>
                <div className="mini-metric">
                  <strong>Human role</strong>
                  <p className="support-text">{blueprint.humanAction}</p>
                </div>
                <div className="mini-metric">
                  <strong>Current stage key</strong>
                  <p className="support-text">{activeStageKey}</p>
                </div>
              </div>

              <label>
                Prompt note to the agent
                <textarea
                  rows={4}
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  placeholder="Example: use conservative convergence, expect correlated oxide behavior, keep MLIP pre-relax in mind."
                />
              </label>

              <div className="inline-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => handleGenerateRecommendations(activeStageKey)}
                  disabled={busyKey === `generate-${activeStageKey}`}
                >
                  {busyKey === `generate-${activeStageKey}` ? "Generating..." : "Generate recommendation"}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setActiveTab("materials")}
                >
                  Back to materials context
                </button>
              </div>

              {currentStep?.recommendation_summary ? (
                <div className="hint-box">
                  <strong>Recommendation summary</strong>
                  <p className="support-text">{currentStep.recommendation_summary}</p>
                </div>
              ) : null}
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Review surface</p>
                  <h2>Editable recommendation table</h2>
                </div>
              </div>

              {currentStep && currentStep.parameters.length > 0 ? (
                <div className="parameter-table">
                  <div className="parameter-table-head">
                    <span>Parameter</span>
                    <span>AI suggestion</span>
                    <span>Final editable value</span>
                  </div>
                  {currentStep.parameters.map((parameter) => (
                    <div className="parameter-row" key={parameter.id}>
                      <div>
                        <strong>{parameter.name}</strong>
                        <p className="meta-label">{parameter.category ?? "general"}</p>
                      </div>
                      <div className="parameter-cell">
                        <pre>{serializeValue(parameter.suggested_value)}</pre>
                        <p className="support-text">{parameter.rationale}</p>
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
                  No parameters are loaded for this stage yet. Generate a recommendation first.
                </p>
              )}

              <label>
                Approval or validation note
                <textarea
                  rows={3}
                  value={approvalNote}
                  onChange={(event) => setApprovalNote(event.target.value)}
                  placeholder="Explain why you accepted, edited, or validated these values."
                />
              </label>

              <div className="inline-actions">
                <button
                  className="primary-button"
                  disabled={!currentStep || busyKey === `approve-${activeStageKey}-draft`}
                  onClick={() => handleApproveCurrentStep(false)}
                  type="button"
                >
                  {busyKey === `approve-${activeStageKey}-draft` ? "Saving..." : "Approve stage"}
                </button>
                <button
                  className="secondary-button"
                  disabled={!currentStep || busyKey === `approve-${activeStageKey}-validated`}
                  onClick={() => handleApproveCurrentStep(true)}
                  type="button"
                >
                  {busyKey === `approve-${activeStageKey}-validated`
                    ? "Saving..."
                    : "Approve + add to library"}
                </button>
                <button
                  className="secondary-button"
                  disabled={!currentStep || busyKey === `validate-${activeStageKey}`}
                  onClick={handleValidateCurrentStep}
                  type="button"
                >
                  {busyKey === `validate-${activeStageKey}` ? "Validating..." : "Validate existing stage"}
                </button>
              </div>

              {currentWarnings.length ? (
                <div className="hint-box warning-surface">
                  <strong>Warnings</strong>
                  {currentWarnings.map((warning, index) => (
                    <p
                      className="support-text"
                      key={`${currentStep?.id ?? activeStageKey}-warning-${index}`}
                    >
                      {serializeValue(warning)}
                    </p>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="content-grid dashboard-grid">
              <article className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Revision trail</p>
                    <h2>Recent changes</h2>
                  </div>
                </div>
                <div className="stack-list">
                  {recentRevisions.map((revision) => (
                    <article className="history-item" key={revision.id}>
                      <div className="inline-spread">
                        <strong>{revision.action}</strong>
                        <span className="meta-label">v{revision.version_number}</span>
                      </div>
                      <p className="support-text">{revision.note || "No note supplied."}</p>
                      <span className="meta-label">
                        {new Date(revision.created_at).toLocaleString()}
                      </span>
                    </article>
                  ))}
                  {!currentStep?.revisions?.length ? (
                    <p className="muted-text">No revision history yet for this stage.</p>
                  ) : null}
                </div>
              </article>

              <article className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Context snapshot</p>
                    <h2>What the agent sees</h2>
                  </div>
                </div>
                {currentContextSnapshot ? (
                  <pre>{serializeValue(currentContextSnapshot)}</pre>
                ) : (
                  <p className="muted-text">
                    The stage snapshot will appear here after recommendation generation.
                  </p>
                )}
              </article>
            </section>
          </div>
        </section>
      ) : null}

      {activeTab === "execution" ? (
        <section className="content-stack">
          <section className="content-grid dashboard-grid">
            <article className="panel form-grid">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Backend bridge</p>
                  <h2>DFT execution routing</h2>
                </div>
              </div>
              <label>
                Execution backend
                <select
                  value={executionBackend}
                  onChange={(event) => setExecutionBackend(event.target.value as "ase" | "ssh")}
                >
                  <option value="ase">ASE / local VASP adapter</option>
                  <option value="ssh">SSH / scheduler host</option>
                </select>
              </label>
              <label>
                Compute profile
                <select
                  value={selectedConnectionId}
                  onChange={(event) => setSelectedConnectionId(event.target.value)}
                  disabled={executionBackend !== "ssh"}
                >
                  <option value="">Select a remote profile</option>
                  {connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.name} ({connection.username}@{connection.host})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Launch command
                <input
                  value={launchCommand}
                  onChange={(event) => setLaunchCommand(event.target.value)}
                  placeholder="Example: mpirun -np 32 vasp_std"
                />
              </label>
              <label>
                Working directory override
                <input
                  value={workingDirectory}
                  onChange={(event) => setWorkingDirectory(event.target.value)}
                  placeholder="Optional custom working directory"
                />
              </label>
              <div className="hint-box">
                <strong>Current route</strong>
                <p className="support-text">
                  {executionBackend === "ase"
                    ? "The existing backend already supports ASE-based VASP execution."
                    : selectedConnection
                      ? `Will target ${selectedConnection.name} using ${selectedConnection.scheduler_type}.`
                      : "Pick an SSH connection profile before submitting a remote job."}
                </p>
              </div>
              <button
                className="primary-button"
                disabled={busyKey === "execute"}
                onClick={handleSubmitRun}
                type="button"
              >
                {busyKey === "execute" ? "Submitting..." : "Submit DFT job"}
              </button>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">MLIP scout</p>
                  <h2>Trajectory preview framework</h2>
                </div>
              </div>
              <div className="compact-grid">
                <label>
                  Placeholder MLIP model
                  <select
                    value={mlipModel}
                    onChange={(event) =>
                      setMlipModel(event.target.value as (typeof MLIP_MODELS)[number])
                    }
                  >
                    {MLIP_MODELS.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Preview mode
                  <select
                    value={mlipTrajectory}
                    onChange={(event) =>
                      setMlipTrajectory(event.target.value as (typeof MLIP_TRAJECTORIES)[number])
                    }
                  >
                    {MLIP_TRAJECTORIES.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="trajectory-card">
                <svg className="trajectory-svg" viewBox="0 0 320 180" role="img" aria-label="MLIP trajectory preview placeholder">
                  <line x1="24" y1="24" x2="24" y2="150" className="chart-axis" />
                  <line x1="24" y1="150" x2="296" y2="150" className="chart-axis" />
                  <polyline points={trajectoryPolyline} className="chart-line" />
                  {trajectorySeries.map((point, index) => {
                    const x = 32 + index * 52;
                    const y = 145 - ((point.energy - trajectoryMin) / trajectorySpread) * 85;
                    return (
                      <g key={`${point.step}-${point.energy}`}>
                        <circle cx={x} cy={y} r="4" className="chart-node" />
                        <text x={x - 8} y="168" className="chart-label">
                          {index}
                        </text>
                      </g>
                    );
                  })}
                </svg>
                <div className="mini-grid">
                  <div className="mini-metric">
                    <strong>Model</strong>
                    <span>{mlipModel}</span>
                  </div>
                  <div className="mini-metric">
                    <strong>Preview lane</strong>
                    <span>{mlipTrajectory}</span>
                  </div>
                  <div className="mini-metric">
                    <strong>Atom estimate</strong>
                    <span>{structureSummary.atomCount || "Unknown"}</span>
                  </div>
                  <div className="mini-metric">
                    <strong>Purpose</strong>
                    <span>Pre-relax / rough trend preview before DFT</span>
                  </div>
                </div>
              </div>
              <div className="hint-box">
                <strong>Implementation note</strong>
                <p className="support-text">
                  This is a front-end scaffold for future MLIP calculators. Once the backend adds model
                  adapters, this lane can swap from placeholder curves to real trajectories.
                </p>
              </div>
            </article>
          </section>

          <section className="content-grid dashboard-grid">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Ready connectors</p>
                  <h2>Current backend coverage</h2>
                </div>
              </div>
              <div className="stack-list">
                <article className="capability-card">
                  <strong>ASE + VASP</strong>
                  <p className="support-text">
                    Already supported by the backend and directly compatible with the execution endpoint.
                  </p>
                </article>
                <article className="capability-card">
                  <strong>SSH + SLURM/PBS/direct shell</strong>
                  <p className="support-text">
                    Already represented through saved connection profiles and scheduler metadata.
                  </p>
                </article>
                <article className="capability-card">
                  <strong>MLIP adapters</strong>
                  <p className="support-text">
                    Front-end placement is ready; future backend work can add calculators like MACE or CHGNet behind the same contract.
                  </p>
                </article>
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Recent executions</p>
                  <h2>Queue snapshot</h2>
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
                  </article>
                ))}
                {executions.length === 0 ? (
                  <p className="muted-text">No executions have been submitted from this session yet.</p>
                ) : null}
              </div>
            </article>
          </section>
        </section>
      ) : null}

      {activeTab === "history" ? (
        <section className="content-grid dashboard-grid">
          <article className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Conversation</p>
                <h2>Agent history</h2>
              </div>
            </div>
            <div className="stack-list">
              {chatMessages.length === 0 ? <p className="muted-text">No chat history yet.</p> : null}
              {chatMessages.map((item) => (
                <article className={`chat-card role-${item.role}`} key={item.id}>
                  <div className="inline-spread">
                    <strong>{item.role}</strong>
                    <span className="meta-label">{new Date(item.created_at).toLocaleString()}</span>
                  </div>
                  <pre>{item.content}</pre>
                </article>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Executions</p>
                <h2>Status and outputs</h2>
              </div>
            </div>
            <div className="stack-list">
              {executions.length === 0 ? <p className="muted-text">No execution history yet.</p> : null}
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
                  {execution.stdout_excerpt ? <pre>{execution.stdout_excerpt}</pre> : null}
                  {execution.stderr_excerpt ? <pre>{execution.stderr_excerpt}</pre> : null}
                  <button
                    className="secondary-button"
                    disabled={busyKey === `refresh-${execution.id}`}
                    onClick={() => handleRefreshExecution(execution.id)}
                    type="button"
                  >
                    {busyKey === `refresh-${execution.id}` ? "Refreshing..." : "Refresh status"}
                  </button>
                </article>
              ))}
            </div>
          </article>
        </section>
      ) : null}
    </section>
  );
}
