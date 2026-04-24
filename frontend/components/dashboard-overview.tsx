import Link from "next/link";
import { ArrowRight, Cpu, Database, ListChecks, Settings } from "lucide-react";

import { STAGE_BLUEPRINTS } from "@/lib/studio";
import type { KnowledgeEntry, SSHConnectionProfile, WorkflowSession } from "@/lib/types";

interface DashboardOverviewProps {
  sessions: WorkflowSession[];
  connections: SSHConnectionProfile[];
  knowledgeEntries: KnowledgeEntry[];
  warning: string | null;
}

const FLOW_GROUPS = [
  {
    title: "材料准备",
    icon: ListChecks,
    stages: ["structure-prep", "poscar-validation"],
    tools: ["结构导入", "POSCAR 检查", "问题报告"],
  },
  {
    title: "参数确认",
    icon: Settings,
    stages: ["incar-recommendation", "kpoints-configuration", "potcar-guidance"],
    tools: ["INCAR 推荐", "KPOINTS 估算", "POTCAR 指引"],
  },
  {
    title: "计算提交",
    icon: Cpu,
    stages: ["submission-prep"],
    tools: ["后端路由", "资源预算", "提交预检"],
  },
  {
    title: "结果归档",
    icon: Database,
    stages: ["result-review"],
    tools: ["状态刷新", "输出摘要", "知识库归档"],
  },
];

export function DashboardOverview({
  sessions,
  connections,
  knowledgeEntries,
  warning,
}: DashboardOverviewProps) {
  const activeSessions = sessions.filter((session) => session.status.toLowerCase() !== "completed");
  const validatedCount = knowledgeEntries.filter((entry) => entry.validated).length;

  return (
    <div className="content-stack">
      <section className="hero studio-hero">
        <div className="hero-copy">
          <p className="eyebrow">DFT / VASP 流程首页</p>
          <h1>按流程打开工具，完成检查后统一提交。</h1>
          <p className="lede">
            首页现在只作为流程总览：每个工作条目会在独立工作区里按步骤展开工具，
            工具完成或报错后回到上一级流程，最后只保留一次提交动作。
          </p>
          <div className="hero-actions">
            <Link className="primary-button icon-button-label" href="/sessions">
              打开工作条目
              <ArrowRight size={16} />
            </Link>
            <Link className="secondary-link icon-button-label" href="/connections">
              计算配置
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
        <div className="hero-stats metric-grid">
          <article className="metric-card">
            <span className="metric-value">{activeSessions.length}</span>
            <span className="metric-label">进行中条目</span>
          </article>
          <article className="metric-card">
            <span className="metric-value">{connections.length}</span>
            <span className="metric-label">计算连接</span>
          </article>
          <article className="metric-card">
            <span className="metric-value">{validatedCount}</span>
            <span className="metric-label">已验证知识</span>
          </article>
          <article className="metric-card">
            <span className="metric-value">{Object.keys(STAGE_BLUEPRINTS).length}</span>
            <span className="metric-label">流程步骤</span>
          </article>
        </div>
      </section>

      {warning ? <p className="panel warning-text">{warning}</p> : null}

      <section className="process-overview-grid">
        {FLOW_GROUPS.map((group, index) => {
          const Icon = group.icon;
          return (
            <article className="process-overview-card" key={group.title}>
              <div className="inline-spread">
                <span className="stage-index">{index + 1}</span>
                <Icon size={22} />
              </div>
              <div>
                <p className="eyebrow">流程</p>
                <h2>{group.title}</h2>
              </div>
              <div className="stack-list">
                {group.stages.map((stageKey) => (
                  <div className="compact-stage-row" key={stageKey}>
                    <strong>{STAGE_BLUEPRINTS[stageKey]?.title ?? stageKey}</strong>
                    <p className="support-text">{STAGE_BLUEPRINTS[stageKey]?.intent}</p>
                  </div>
                ))}
              </div>
              <div className="tag-row">
                {group.tools.map((tool) => (
                  <span className="tag-chip" key={tool}>
                    {tool}
                  </span>
                ))}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
