export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface StepParameter {
  id: string;
  name: string;
  category: string | null;
  suggested_value: JsonValue;
  edited_value: JsonValue;
  approved_value: JsonValue;
  unit: string | null;
  rationale: string;
  uncertainty_note: string | null;
  source_metadata: Record<string, JsonValue> | null;
  is_locked: boolean;
}

export interface StepRevision {
  id: string;
  version_number: number;
  actor_type: string;
  action: string;
  payload: Record<string, JsonValue>;
  note: string | null;
  created_at: string;
}

export interface WorkflowStep {
  id: string;
  session_id: string;
  stage_key: string;
  stage_name: string;
  stage_index: number;
  status: string;
  context_snapshot: Record<string, JsonValue> | null;
  recommendation_summary: string | null;
  warnings: JsonValue[] | null;
  user_notes: string | null;
  validated: boolean;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  parameters: StepParameter[];
  revisions: StepRevision[];
}

export interface WorkflowSession {
  id: string;
  title: string;
  goal: string;
  material_system: string | null;
  calculation_type: string;
  status: string;
  current_stage_key: string | null;
  constraints: Record<string, JsonValue> | null;
  structure_text: string | null;
  user_notes: string | null;
  connection_profile_id: string | null;
  created_at: string;
  updated_at: string;
  steps: WorkflowStep[];
}

export interface ConversationMessage {
  id: string;
  session_id: string;
  step_id: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  stage_key: string | null;
  metadata_json: Record<string, JsonValue> | null;
  created_at: string;
}

export interface SSHConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_method: string;
  ssh_key_path: string | null;
  remote_workdir: string;
  scheduler_type: string;
  scheduler_submit_command: string | null;
  extra_metadata: Record<string, JsonValue> | null;
  last_tested_at: string | null;
  created_at: string;
  updated_at: string;
  has_secret: boolean;
}

export interface ExecutionRecord {
  id: string;
  session_id: string;
  step_id: string | null;
  connection_profile_id: string | null;
  executor_type: string;
  status: string;
  remote_job_id: string | null;
  remote_path: string;
  submission_command: string | null;
  status_command: string | null;
  input_manifest: Record<string, JsonValue> | null;
  output_manifest: Record<string, JsonValue> | null;
  stdout_excerpt: string | null;
  stderr_excerpt: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeEntry {
  id: string;
  source_session_id: string | null;
  source_step_id: string | null;
  material_system: string | null;
  calculation_type: string;
  stage_key: string;
  task_goal: string;
  validated: boolean;
  trust_score: number;
  validation_note: string | null;
  parameter_snapshot: Record<string, JsonValue>;
  outcome_summary: Record<string, JsonValue> | null;
  provenance: Record<string, JsonValue> | null;
  embedding: number[] | null;
  created_at: string;
  updated_at: string;
}
