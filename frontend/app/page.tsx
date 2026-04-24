import { DashboardOverview } from "@/components/dashboard-overview";
import { getConnections, getKnowledgeEntries, getWorkflowSessions } from "@/lib/api";
import type { KnowledgeEntry, SSHConnectionProfile, WorkflowSession } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadDashboard(): Promise<{
  sessions: WorkflowSession[];
  connections: SSHConnectionProfile[];
  knowledgeEntries: KnowledgeEntry[];
  warning: string | null;
}> {
  const [sessionsResult, connectionsResult, knowledgeResult] = await Promise.allSettled([
    getWorkflowSessions(),
    getConnections(),
    getKnowledgeEntries()
  ]);

  const warnings = [
    sessionsResult.status === "rejected" ? sessionsResult.reason : null,
    connectionsResult.status === "rejected" ? connectionsResult.reason : null,
    knowledgeResult.status === "rejected" ? knowledgeResult.reason : null
  ]
    .map((item) => (item instanceof Error ? item.message : null))
    .filter((item): item is string => Boolean(item));

  return {
    sessions: sessionsResult.status === "fulfilled" ? sessionsResult.value : [],
    connections: connectionsResult.status === "fulfilled" ? connectionsResult.value : [],
    knowledgeEntries: knowledgeResult.status === "fulfilled" ? knowledgeResult.value : [],
    warning:
      warnings.length > 0
        ? `部分后端数据暂不可用：${warnings.join(" | ")}`
        : null
  };
}

export default async function HomePage() {
  const { sessions, connections, knowledgeEntries, warning } = await loadDashboard();

  return (
    <DashboardOverview
      sessions={sessions}
      connections={connections}
      knowledgeEntries={knowledgeEntries}
      warning={warning}
    />
  );
}

