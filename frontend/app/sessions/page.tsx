import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";

import { StatusPill } from "@/components/status-pill";
import { getWorkflowSessions } from "@/lib/api";
import { formatCalculationType, summarizeSessionProgress } from "@/lib/studio";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const sessions = await getWorkflowSessions().catch(() => []);

  return (
    <div className="content-stack">
      <section className="hero compact-hero">
        <div className="hero-copy">
          <p className="eyebrow">工作条目</p>
          <h1>从这里进入具体流程工作区。</h1>
          <p className="lede">
            首页不再承载创建和最近条目。这里集中管理条目列表，需要新任务时再进入创建页。
          </p>
          <div className="hero-actions">
            <Link className="primary-button icon-button-label" href="/sessions/new">
              <Plus size={16} />
              创建工作条目
            </Link>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">列表</p>
            <h2>已有工作条目</h2>
          </div>
          <span className="meta-label">{sessions.length} 个条目</span>
        </div>

        <div className="stack-list">
          {sessions.length === 0 ? (
            <p className="muted-text">还没有工作条目。</p>
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
                  <span className="tag-chip">{session.material_system || "材料待定"}</span>
                  <span className="tag-chip">{formatCalculationType(session.calculation_type)}</span>
                  <span className="tag-chip">
                    已完成 {progress.approved}/{progress.total}
                  </span>
                </div>
                <span className="secondary-link icon-button-label align-start">
                  打开流程
                  <ArrowRight size={16} />
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
