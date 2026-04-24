import Link from "next/link";
import { ArrowRight, Boxes, Cpu, Database, Settings } from "lucide-react";

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
    icon: Boxes,
    description: "上传或粘贴 POSCAR/CIF，完成结构导入、预览和基础检查。",
    href: "/materials",
    actionLabel: "进入材料准备",
    tools: ["结构导入", "POSCAR 检查", "问题报告"],
  },
  {
    title: "参数确认",
    icon: Settings,
    description: "由 AI 结合本地 RAG 推荐 INCAR、KPOINTS 与 POTCAR，再人工确认最终值。",
    href: "/sessions",
    actionLabel: "进入参数确认",
    tools: ["AI 推荐", "本地 RAG", "人工确认"],
  },
  {
    title: "计算提交",
    icon: Cpu,
    description: "把已确认的参数映射到后端、资源预算和提交预检。",
    href: "/connections",
    actionLabel: "进入计算配置",
    tools: ["后端配置", "资源预算", "提交预检"],
  },
  {
    title: "结果归档",
    icon: Database,
    description: "审查计算输出，把确认后的有效案例归档到本地知识库。",
    href: "/sessions",
    actionLabel: "进入结果归档",
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
      <section className="page-intro">
        <div>
          <p className="eyebrow">流程首页</p>
          <h1>只从 1-4 流程进入工具。</h1>
          <p className="lede">
            主界面不再重复展示材料、工作条目、计算和 AI 配置入口；AI 配置统一在右上角，
            具体工具只在对应流程里展开。
          </p>
        </div>
        <div className="intro-status-row">
          <span className="status-pill">进行中 {activeSessions.length}</span>
          <span className="status-pill">计算连接 {connections.length}</span>
          <span className="status-pill">本地 RAG {validatedCount}</span>
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
              <p className="support-text">{group.description}</p>
              <div className="tag-row">
                {group.tools.map((tool) => (
                  <span className="tag-chip" key={tool}>
                    {tool}
                  </span>
                ))}
              </div>
              <Link className="secondary-link icon-button-label align-start" href={group.href}>
                {group.actionLabel}
                <ArrowRight size={16} />
              </Link>
            </article>
          );
        })}
      </section>
    </div>
  );
}
