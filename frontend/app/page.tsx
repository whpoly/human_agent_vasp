import Link from "next/link";

import { SessionCreateForm } from "@/components/session-create-form";
import { StatusPill } from "@/components/status-pill";
import { getConnections, getWorkflowSessions } from "@/lib/api";
import type { SSHConnectionProfile, WorkflowSession } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadDashboard(): Promise<{
  sessions: WorkflowSession[];
  connections: SSHConnectionProfile[];
  warning: string | null;
}> {
  try {
    const [sessions, connections] = await Promise.all([getWorkflowSessions(), getConnections()]);
    return { sessions, connections, warning: null };
  } catch (error) {
    return {
      sessions: [],
      connections: [],
      warning:
        error instanceof Error
          ? error.message
          : "Backend unavailable. Start the FastAPI server to load workflow data."
    };
  }
}

export default async function HomePage() {
  const { sessions, connections, warning } = await loadDashboard();

  return (
    <div className="content-stack">
      <section className="hero">
        <div>
          <p className="eyebrow">Production-oriented MVP</p>
          <h1>Reviewable VASP recommendations, explicit approvals, and practical SSH execution.</h1>
          <p className="lede">
            This UI keeps scientists in the loop at every step: recommendations stay editable,
            rationale stays visible, and only approved settings can move toward execution.
          </p>
        </div>
        <div className="hero-stats">
          <article className="metric-card">
            <span className="metric-value">{sessions.length}</span>
            <span className="metric-label">Workflow sessions</span>
          </article>
          <article className="metric-card">
            <span className="metric-value">{connections.length}</span>
            <span className="metric-label">SSH profiles</span>
          </article>
        </div>
      </section>

      {warning ? <p className="panel warning-text">{warning}</p> : null}

      <section className="content-grid">
        <SessionCreateForm />

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Workflow sessions</p>
              <h2>Recent work</h2>
            </div>
            <Link className="secondary-link" href="/connections">
              SSH settings
            </Link>
          </div>

          <div className="stack-list">
            {sessions.length === 0 ? (
              <p className="muted-text">Create the first workflow session to start collecting reviewed VASP decisions.</p>
            ) : null}
            {sessions.map((session) => (
              <Link className="session-card" href={`/sessions/${session.id}`} key={session.id}>
                <div className="inline-spread">
                  <strong>{session.title}</strong>
                  <StatusPill status={session.status} />
                </div>
                <p>{session.goal}</p>
                <div className="inline-spread">
                  <span className="meta-label">{session.material_system || "Unspecified system"}</span>
                  <span className="meta-label">{session.calculation_type}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

