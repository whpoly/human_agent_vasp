import Link from "next/link";

import { SessionCreateForm } from "@/components/session-create-form";
import { StatusPill } from "@/components/status-pill";
import { STUDIO_MODULES, summarizeSessionProgress } from "@/lib/studio";
import type { KnowledgeEntry, SSHConnectionProfile, WorkflowSession } from "@/lib/types";

interface DashboardOverviewProps {
  sessions: WorkflowSession[];
  connections: SSHConnectionProfile[];
  knowledgeEntries: KnowledgeEntry[];
  warning: string | null;
}

function snapshotPreview(entry: KnowledgeEntry): string[] {
  return Object.entries(entry.parameter_snapshot)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

export function DashboardOverview({
  sessions,
  connections,
  knowledgeEntries,
  warning,
}: DashboardOverviewProps) {
  const activeSessions = sessions.filter((session) => session.status.toLowerCase() !== "completed");
  const approvedSteps = sessions.reduce(
    (total, session) => total + summarizeSessionProgress(session).approved,
    0
  );
  const validatedCount = knowledgeEntries.filter((entry) => entry.validated).length;

  return (
    <div className="content-stack">
      <section className="hero studio-hero">
        <div className="hero-copy">
          <p className="eyebrow">DFT Agent Studio</p>
          <h1>Human-in-the-loop orchestration for materials intake, DFT setup, backend dispatch, and MLIP scouting.</h1>
          <p className="lede">
            The frontend now acts like a real workbench rather than a single-form wizard: scientists
            can gather structures, preprocess with AI help, inspect recommendations, route to DFT
            backends, and keep a reusable parameter library in the same place.
          </p>
          <div className="hero-actions">
            <Link className="primary-button" href="#new-session">
              Start a new studio session
            </Link>
            <Link className="secondary-link" href="/connections">
              Configure DFT backends
            </Link>
          </div>
        </div>
        <div className="hero-stats metric-grid">
          <article className="metric-card">
            <span className="metric-value">{sessions.length}</span>
            <span className="metric-label">Workflow sessions</span>
          </article>
          <article className="metric-card">
            <span className="metric-value">{connections.length}</span>
            <span className="metric-label">Compute profiles</span>
          </article>
          <article className="metric-card">
            <span className="metric-value">{knowledgeEntries.length}</span>
            <span className="metric-label">Parameter library entries</span>
          </article>
          <article className="metric-card">
            <span className="metric-value">{approvedSteps}</span>
            <span className="metric-label">Approved stage decisions</span>
          </article>
        </div>
      </section>

      {warning ? <p className="panel warning-text">{warning}</p> : null}

      <section className="module-grid">
        {STUDIO_MODULES.map((module) => (
          <article className="module-card" key={module.id}>
            <div className="inline-spread">
              <div>
                <p className="eyebrow">Module</p>
                <h2>{module.title}</h2>
              </div>
              <span className="status-pill">{module.status}</span>
            </div>
            <p className="support-text">{module.description}</p>
            <div className="tag-row">
              {module.highlights.map((item) => (
                <span className="tag-chip" key={item}>
                  {item}
                </span>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="content-grid dashboard-grid">
        <div id="new-session">
          <SessionCreateForm />
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Live sessions</p>
              <h2>Recent workbench entries</h2>
            </div>
            <span className="meta-label">{activeSessions.length} active</span>
          </div>

          <div className="stack-list">
            {sessions.length === 0 ? (
              <p className="muted-text">
                No sessions yet. Create one to open the new DFT studio workspace.
              </p>
            ) : null}
            {sessions.map((session) => {
              const progress = summarizeSessionProgress(session);
              return (
                <Link className="session-card" href={`/sessions/${session.id}`} key={session.id}>
                  <div className="inline-spread">
                    <strong>{session.title}</strong>
                    <StatusPill status={session.status} />
                  </div>
                  <p>{session.goal}</p>
                  <div className="tag-row">
                    <span className="tag-chip">{session.material_system || "Material TBD"}</span>
                    <span className="tag-chip">{session.calculation_type}</span>
                    <span className="tag-chip">
                      {progress.approved}/{progress.total} stages approved
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="content-grid dashboard-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Execution fabric</p>
              <h2>DFT backend connections</h2>
            </div>
            <Link className="secondary-link" href="/connections">
              Manage profiles
            </Link>
          </div>
          <div className="stack-list">
            {connections.length === 0 ? (
              <p className="muted-text">
                No compute profiles saved yet. The framework is ready for ASE or SSH-backed hosts.
              </p>
            ) : null}
            {connections.slice(0, 4).map((connection) => (
              <article className="connection-card" key={connection.id}>
                <div className="inline-spread">
                  <strong>{connection.name}</strong>
                  <span className="meta-label">{connection.scheduler_type}</span>
                </div>
                <span>
                  {connection.username}@{connection.host}:{connection.port}
                </span>
                <span className="meta-label">{connection.remote_workdir}</span>
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">RAG / Library</p>
              <h2>Validated parameter snapshots</h2>
            </div>
            <span className="meta-label">{validatedCount} validated</span>
          </div>
          <div className="stack-list">
            {knowledgeEntries.length === 0 ? (
              <p className="muted-text">
                The parameter library is empty right now. As you validate workflow steps, this area
                will become the retrieval seed for future DFT recommendations.
              </p>
            ) : null}
            {knowledgeEntries.slice(0, 4).map((entry) => (
              <article className="knowledge-card" key={entry.id}>
                <div className="inline-spread">
                  <strong>{entry.stage_key}</strong>
                  <span className="meta-label">trust {entry.trust_score.toFixed(2)}</span>
                </div>
                <p className="support-text">{entry.task_goal}</p>
                <div className="tag-row">
                  <span className="tag-chip">{entry.material_system || "Generic material"}</span>
                  <span className="tag-chip">{entry.calculation_type}</span>
                </div>
                {snapshotPreview(entry).map((line) => (
                  <p className="meta-label" key={`${entry.id}-${line}`}>
                    {line}
                  </p>
                ))}
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
