import { notFound } from "next/navigation";

import { WorkflowWizard } from "@/components/workflow-wizard";
import { getConnections, getWorkflowSession } from "@/lib/api";

export const dynamic = "force-dynamic";

interface SessionPageProps {
  params: { sessionId: string };
}

export default async function SessionPage({ params }: SessionPageProps) {
  const { sessionId } = params;

  try {
    const [session, connections] = await Promise.all([
      getWorkflowSession(sessionId),
      getConnections()
    ]);
    return <WorkflowWizard initialSession={session} connections={connections} />;
  } catch {
    notFound();
  }
}
