import {
  ConversationMessage,
  ExecutionRecord,
  KnowledgeEntry,
  SSHConnectionProfile,
  WorkflowSession,
  WorkflowStep
} from "@/lib/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string };
      detail = body.detail ?? detail;
    } catch {
      detail = response.statusText;
    }
    throw new Error(detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function getWorkflowSessions(): Promise<WorkflowSession[]> {
  return apiFetch<WorkflowSession[]>("/workflow-sessions");
}

export async function getWorkflowSession(sessionId: string): Promise<WorkflowSession> {
  return apiFetch<WorkflowSession>(`/workflow-sessions/${sessionId}`);
}

export async function createWorkflowSession(payload: Record<string, unknown>): Promise<WorkflowSession> {
  return apiFetch<WorkflowSession>("/workflow-sessions", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateWorkflowSession(
  sessionId: string,
  payload: Record<string, unknown>
): Promise<WorkflowSession> {
  return apiFetch<WorkflowSession>(`/workflow-sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function generateRecommendations(
  sessionId: string,
  payload: Record<string, unknown>
): Promise<WorkflowStep> {
  return apiFetch<WorkflowStep>(`/workflow-sessions/${sessionId}/recommendations`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function approveStep(
  sessionId: string,
  stepId: string,
  payload: Record<string, unknown>
): Promise<WorkflowStep> {
  return apiFetch<WorkflowStep>(`/workflow-sessions/${sessionId}/steps/${stepId}/approve`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function validateStep(
  sessionId: string,
  stepId: string,
  payload: Record<string, unknown>
): Promise<WorkflowStep> {
  return apiFetch<WorkflowStep>(`/workflow-sessions/${sessionId}/steps/${stepId}/validate`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getConnections(): Promise<SSHConnectionProfile[]> {
  return apiFetch<SSHConnectionProfile[]>("/connections");
}

export async function createConnection(payload: Record<string, unknown>): Promise<SSHConnectionProfile> {
  return apiFetch<SSHConnectionProfile>("/connections", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function testConnection(
  connectionId: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; message: string }> {
  return apiFetch<{ ok: boolean; message: string }>(`/connections/${connectionId}/test`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getExecutions(sessionId: string): Promise<ExecutionRecord[]> {
  return apiFetch<ExecutionRecord[]>(`/workflow-sessions/${sessionId}/executions`);
}

export async function submitExecution(
  sessionId: string,
  payload: Record<string, unknown>
): Promise<ExecutionRecord> {
  return apiFetch<ExecutionRecord>(`/workflow-sessions/${sessionId}/executions`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function refreshExecution(
  sessionId: string,
  executionId: string
): Promise<ExecutionRecord> {
  return apiFetch<ExecutionRecord>(
    `/workflow-sessions/${sessionId}/executions/${executionId}/refresh`,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
}

export async function searchKnowledge(payload: Record<string, unknown>): Promise<KnowledgeEntry[]> {
  return apiFetch<KnowledgeEntry[]>("/knowledge/search", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getKnowledgeEntries(): Promise<KnowledgeEntry[]> {
  return apiFetch<KnowledgeEntry[]>("/knowledge");
}

export async function getChatMessages(sessionId: string): Promise<ConversationMessage[]> {
  return apiFetch<ConversationMessage[]>(`/workflow-sessions/${sessionId}/chat`);
}

export async function createChatMessage(
  sessionId: string,
  payload: Record<string, unknown>
): Promise<ConversationMessage> {
  return apiFetch<ConversationMessage>(`/workflow-sessions/${sessionId}/chat`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
