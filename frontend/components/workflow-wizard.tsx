"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";

import {
  approveStep,
  createChatMessage,
  generateRecommendations,
  getChatMessages,
  getExecutions,
  refreshExecution,
  submitExecution,
  updateWorkflowSession
} from "@/lib/api";
import type {
  ConversationMessage,
  ExecutionRecord,
  JsonValue,
  SSHConnectionProfile,
  StepParameter,
  WorkflowSession,
  WorkflowStep
} from "@/lib/types";
import { StatusPill } from "@/components/status-pill";

interface WorkflowWizardProps {
  initialSession: WorkflowSession;
  connections: SSHConnectionProfile[];
}

const SCF_STAGE_KEY = "incar-recommendation";
const RESOURCE_STAGE_KEY = "submission-prep";

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
      serializeValue(parameter.approved_value ?? parameter.edited_value ?? parameter.suggested_value)
    ])
  );
}

function updateStep(session: WorkflowSession, nextStep: WorkflowStep): WorkflowSession {
  const nextSteps = session.steps.map((step) => (step.id === nextStep.id ? nextStep : step));
  return { ...session, current_stage_key: nextStep.stage_key, steps: nextSteps };
}

function summarizeStep(step: WorkflowStep): string {
  const top = step.parameters.slice(0, 6);
  const lines = top.map((parameter) => {
    const value = parameter.suggested_value ?? parameter.approved_value;
    return `${parameter.name}: ${serializeValue(value)} | ${parameter.rationale}`;
  });
  return `${step.stage_name} recommendation:\n${lines.join("\n")}`;
}

function summarizeExecution(execution: ExecutionRecord): string[] {
  const lines = [
    `status=${execution.status}`,
    `job=${execution.remote_job_id ?? "n/a"}`
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

export function WorkflowWizard({ initialSession, connections }: WorkflowWizardProps) {
  const [session, setSession] = useState(initialSession);
  const [activeTab, setActiveTab] = useState<"assistant" | "history">("assistant");
  const [activeStageKey, setActiveStageKey] = useState<string>(SCF_STAGE_KEY);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState("");
  const [approvalNote, setApprovalNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [chatMessages, setChatMessages] = useState<ConversationMessage[]>([]);
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState(
    initialSession.connection_profile_id ?? connections[0]?.id ?? ""
  );
  const [launchCommand, setLaunchCommand] = useState("mpirun -np 16 vasp_std");
  const [poscarText, setPoscarText] = useState(initialSession.structure_text ?? "");
  const [uploadedName, setUploadedName] = useState("");

  const scfStep = useMemo(
    () => session.steps.find((step) => step.stage_key === SCF_STAGE_KEY),
    [session.steps]
  );
  const resourceStep = useMemo(
    () => session.steps.find((step) => step.stage_key === RESOURCE_STAGE_KEY),
    [session.steps]
  );
  const currentStep = useMemo(
    () => session.steps.find((step) => step.stage_key === activeStageKey),
    [activeStageKey, session.steps]
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

  function updateDraft(parameterName: string, value: string) {
    setDraftValues((current) => ({ ...current, [parameterName]: value }));
  }

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
        step_id: stepId ?? null
      });
      setChatMessages((current) => [...current, created]);
    } catch {
      // The workflow should continue even if chat logging fails.
    }
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

  async function savePoscarAndSessionContext() {
    setBusyKey("save-poscar");
    setMessage(null);
    try {
      const updated = await updateWorkflowSession(session.id, {
        structure_text: poscarText,
        calculation_type: "scf"
      });
      setSession(updated);
      await appendChat(
        "user",
        `Uploaded POSCAR${uploadedName ? ` (${uploadedName})` : ""} and requested SCF setup.`,
        "structure-prep"
      );
      await appendChat(
        "assistant",
        "POSCAR received. Next I will recommend SCF control parameters with rationale.",
        "structure-prep"
      );
      setMessage("POSCAR saved. Continue to SCF parameter recommendation.");
      setActiveStageKey(SCF_STAGE_KEY);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save POSCAR.");
    } finally {
      setBusyKey(null);
    }
  }

  async function generateForStage(stageKey: string, userPrompt: string) {
    setBusyKey(`generate-${stageKey}`);
    setMessage(null);
    await appendChat("user", userPrompt, stageKey);
    try {
      const nextStep = await generateRecommendations(session.id, {
        stage_key: stageKey,
        user_intent: session.goal,
        user_feedback: feedback
      });
      setSession((current) => updateStep(current, nextStep));
      setActiveStageKey(stageKey);
      setFeedback("");
      await appendChat("assistant", summarizeStep(nextStep), stageKey, nextStep.id);
      setMessage("Agent recommendation is ready. You can edit and approve any parameter.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to generate recommendations.");
    } finally {
      setBusyKey(null);
    }
  }

  async function approveCurrentStep() {
    if (!currentStep) {
      return;
    }
    setBusyKey(`approve-${currentStep.stage_key}`);
    setMessage(null);
    try {
      const nextStep = await approveStep(session.id, currentStep.id, {
        parameters: currentStep.parameters.map((parameter: StepParameter) => {
          const approved = parseEditorValue(draftValues[parameter.name] ?? "");
          return {
            name: parameter.name,
            edited_value:
              serializeValue(parameter.suggested_value) === serializeValue(approved) ? null : approved,
            approved_value: approved
          };
        }),
        note: approvalNote,
        mark_validated: false
      });
      setSession((current) => updateStep(current, nextStep));
      await appendChat(
        "user",
        `Approved ${nextStep.stage_name}. Note: ${approvalNote || "no extra note"}`,
        nextStep.stage_key,
        nextStep.id
      );
      await appendChat(
        "assistant",
        `${nextStep.stage_name} approved and stored. Proceed to the next step.`,
        nextStep.stage_key,
        nextStep.id
      );
      setApprovalNote("");
      if (nextStep.stage_key === SCF_STAGE_KEY) {
        setActiveStageKey(RESOURCE_STAGE_KEY);
      }
      setMessage("Approved values saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to approve step.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSubmitRun() {
    if (!selectedConnectionId) {
      setMessage("Please choose a connected remote compute resource.");
      return;
    }
    setBusyKey("execute");
    setMessage(null);
    await appendChat(
      "user",
      "Submit SCF job with approved parameters on the selected remote resource.",
      RESOURCE_STAGE_KEY,
      resourceStep?.id
    );
    try {
      const execution = await submitExecution(session.id, {
        execution_backend: "ssh",
        connection_profile_id: selectedConnectionId,
        launch_command: launchCommand
      });
      setExecutions((current) => [execution, ...current]);
      await appendChat(
        "assistant",
        `Run submitted. job=${execution.remote_job_id ?? "pending"} status=${execution.status}`,
        RESOURCE_STAGE_KEY,
        resourceStep?.id
      );
      setMessage("SCF task submitted. Check Task History for outputs.");
      setActiveTab("history");
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
        `Execution ${refreshed.id} refreshed: status=${refreshed.status}`,
        RESOURCE_STAGE_KEY,
        resourceStep?.id
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to refresh execution.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="content-stack">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">SCF Assistant App</p>
            <h2>{session.title}</h2>
          </div>
          <StatusPill status={session.status} />
        </div>
        <p className="lede">{session.goal}</p>
        <div className="inline-actions">
          <button
            className={`secondary-button ${activeTab === "assistant" ? "selected-tab" : ""}`}
            type="button"
            onClick={() => setActiveTab("assistant")}
          >
            Assistant
          </button>
          <button
            className={`secondary-button ${activeTab === "history" ? "selected-tab" : ""}`}
            type="button"
            onClick={() => setActiveTab("history")}
          >
            Task History
          </button>
          <Link className="secondary-link" href="/connections">
            Settings: Compute Resources
          </Link>
        </div>
      </section>

      {activeTab === "assistant" ? (
        <section className="content-grid">
          <div className="panel form-grid">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Step 1</p>
                <h2>Upload POSCAR</h2>
              </div>
            </div>
            <label>
              POSCAR file
              <input type="file" accept=".vasp,.poscar,.txt,*/*" onChange={handlePoscarFile} />
            </label>
            <label>
              POSCAR content
              <textarea
                rows={12}
                value={poscarText}
                onChange={(event) => setPoscarText(event.target.value)}
                placeholder="Paste POSCAR content here."
              />
            </label>
            <button
              className="primary-button"
              type="button"
              onClick={savePoscarAndSessionContext}
              disabled={busyKey === "save-poscar" || !poscarText.trim()}
            >
              {busyKey === "save-poscar" ? "Saving..." : "Save POSCAR"}
            </button>
          </div>

          <div className="panel form-grid">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Step 2-3</p>
                <h2>Agent Recommendations</h2>
              </div>
            </div>
            <div className="inline-actions">
              <button
                className={`secondary-button ${activeStageKey === SCF_STAGE_KEY ? "selected-tab" : ""}`}
                type="button"
                onClick={() => setActiveStageKey(SCF_STAGE_KEY)}
              >
                SCF Parameters
              </button>
              <button
                className={`secondary-button ${activeStageKey === RESOURCE_STAGE_KEY ? "selected-tab" : ""}`}
                type="button"
                onClick={() => setActiveStageKey(RESOURCE_STAGE_KEY)}
              >
                Compute Resources
              </button>
            </div>

            <label>
              Prompt note to agent
              <textarea
                rows={3}
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                placeholder="Example: prioritize stable SCF convergence and conservative settings."
              />
            </label>
            {activeStageKey === SCF_STAGE_KEY ? (
              <button
                className="primary-button"
                type="button"
                onClick={() =>
                  generateForStage(
                    SCF_STAGE_KEY,
                    "Please recommend SCF parameters and explain each key choice."
                  )
                }
                disabled={busyKey === `generate-${SCF_STAGE_KEY}`}
              >
                {busyKey === `generate-${SCF_STAGE_KEY}` ? "Generating..." : "Recommend SCF parameters"}
              </button>
            ) : (
              <button
                className="primary-button"
                type="button"
                onClick={() =>
                  generateForStage(
                    RESOURCE_STAGE_KEY,
                    "Please recommend compute resource settings for this SCF run."
                  )
                }
                disabled={busyKey === `generate-${RESOURCE_STAGE_KEY}`}
              >
                {busyKey === `generate-${RESOURCE_STAGE_KEY}` ? "Generating..." : "Recommend resource parameters"}
              </button>
            )}

            {currentStep ? (
              <>
                <p className="muted-text">{currentStep.recommendation_summary || "No recommendation yet."}</p>
                <div className="parameter-table">
                  <div className="parameter-table-head">
                    <span>Parameter</span>
                    <span>Agent suggested</span>
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
                <label>
                  Approval note
                  <textarea
                    rows={2}
                    value={approvalNote}
                    onChange={(event) => setApprovalNote(event.target.value)}
                    placeholder="Optional note for why you accepted or changed values."
                  />
                </label>
                <button
                  className="primary-button"
                  type="button"
                  onClick={approveCurrentStep}
                  disabled={busyKey === `approve-${currentStep.stage_key}`}
                >
                  {busyKey === `approve-${currentStep.stage_key}` ? "Saving..." : "Approve this step"}
                </button>
              </>
            ) : (
              <p className="muted-text">No stage data loaded yet.</p>
            )}
          </div>
        </section>
      ) : null}

      {activeTab === "assistant" ? (
        <section className="panel form-grid">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Step 4</p>
              <h2>Run SCF Job</h2>
            </div>
          </div>
          <label>
            Connected compute resource
            <select value={selectedConnectionId} onChange={(event) => setSelectedConnectionId(event.target.value)}>
              <option value="">Select remote resource</option>
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name} ({connection.username}@{connection.host})
                </option>
              ))}
            </select>
          </label>
          <label>
            Launch command
            <input value={launchCommand} onChange={(event) => setLaunchCommand(event.target.value)} />
          </label>
          <button className="primary-button" type="button" onClick={handleSubmitRun} disabled={busyKey === "execute"}>
            {busyKey === "execute" ? "Submitting..." : "Submit SCF task"}
          </button>
          {message ? <p className="inline-message">{message}</p> : null}
        </section>
      ) : null}

      {activeTab === "history" ? (
        <section className="content-grid">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Chat Records</p>
                <h2>Agent conversation</h2>
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
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Run Outputs</p>
                <h2>Important execution info</h2>
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
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => handleRefreshExecution(execution.id)}
                    disabled={busyKey === `refresh-${execution.id}`}
                  >
                    {busyKey === `refresh-${execution.id}` ? "Refreshing..." : "Refresh status"}
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </section>
  );
}
