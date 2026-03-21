# 1. Product Requirements Summary

## Product intent

- Build a human-in-the-loop assistant for VASP-based DFT workflows.
- Optimize for accuracy, traceability, and usability rather than full autonomy.
- Require explicit human review and approval before remote execution.

## MVP scope

- Configurable multi-step workflow stages for structure preparation, POSCAR review, INCAR and KPOINTS setup, POTCAR guidance, submission preparation, and result review.
- Agent-generated VASP parameter recommendations with rationale, uncertainty notes, and provenance references.
- Lightweight frontend for creating workflow sessions, editing parameters, approving steps, and configuring SSH access.
- Practical SSH-based remote execution abstraction with room for direct shell, SLURM, and PBS.
- Knowledge accumulation through explicitly validated workflow records.

# 2. System Architecture

## Layers

- `frontend`: Next.js UI for review, approval, connection management, and execution monitoring.
- `backend API`: FastAPI service exposing workflow, recommendation, connection, execution, and knowledge endpoints.
- `recommendation service`: stage-aware heuristics plus retrieval from validated historical cases.
- `knowledge layer`: PostgreSQL-backed validated records with structured metadata and optional embeddings.
- `execution layer`: ASE-first execution service using `ase.calculators.vasp.Vasp`, plus a legacy Paramiko SSH executor with scheduler abstraction.
- `audit layer`: append-only audit events plus step revision history.

## Core loop

1. User creates a workflow session with goal, material context, and optional structure text.
2. Backend initializes configurable stages.
3. User requests a recommendation for the current stage.
4. Recommendation engine combines current context, approved prior steps, and validated historical cases.
5. Agent returns suggested values, rationale, uncertainty notes, and provenance.
6. User edits and approves the step.
7. Approved values generate VASP inputs and can be executed through ASE VASP or submitted remotely over SSH.
8. Validated outcomes are promoted into the reusable knowledge base.

# 3. Data Model

## Main entities

- `workflow_sessions`
  - session-level goal, material system, calculation type, notes, current stage, and selected connection profile
- `workflow_steps`
  - one row per configured stage with status, context snapshot, warnings, and validation state
- `step_parameters`
  - stores `suggested_value`, `edited_value`, and `approved_value` separately for each parameter
- `step_revisions`
  - immutable version snapshots for recommendation runs and approvals
- `ssh_connection_profiles`
  - host metadata, auth method, encrypted secret, workdir, and scheduler settings
- `execution_records`
  - submission command, backend type, job id or pid, working path, and output excerpts
- `knowledge_entries`
  - validated reusable parameter sets, provenance, trust score, and optional embedding payload
- `audit_logs`
  - append-only cross-entity operational timeline

## Traceability choices

- Every step stores both machine suggestion and human-approved value.
- Revision payloads preserve what was recommended and what was approved.
- Audit logs record creation, recommendation generation, approval, validation, and execution events.

# 4. API Design

## Workflow

- `GET /api/v1/workflow-sessions`
- `POST /api/v1/workflow-sessions`
- `GET /api/v1/workflow-sessions/{session_id}`
- `PATCH /api/v1/workflow-sessions/{session_id}`
- `POST /api/v1/workflow-sessions/{session_id}/recommendations`
- `POST /api/v1/workflow-sessions/{session_id}/steps/{step_id}/approve`
- `POST /api/v1/workflow-sessions/{session_id}/steps/{step_id}/validate`

## Conversation

- `GET /api/v1/workflow-sessions/{session_id}/chat`
- `POST /api/v1/workflow-sessions/{session_id}/chat`

## Remote connection

- `GET /api/v1/connections`
- `POST /api/v1/connections`
- `POST /api/v1/connections/{connection_id}/test`

## Execution

- `GET /api/v1/workflow-sessions/{session_id}/executions`
- `POST /api/v1/workflow-sessions/{session_id}/executions`
- `POST /api/v1/workflow-sessions/{session_id}/executions/{execution_id}/refresh`

`POST /executions` now accepts an execution backend selector. The recommended path is `execution_backend="ase"` with `calculator_name="vasp"`.

## Knowledge

- `GET /api/v1/knowledge`
- `POST /api/v1/knowledge/search`

# 5. Frontend Design

## Pages

- `/`
  - dashboard, workflow creation form, recent sessions
- `/sessions/[sessionId]`
  - stage navigation, editable parameter review, rationale display, revision history, knowledge references, execution panel
- `/connections`
  - SSH profile form, saved profiles, test action

## Important UI behaviors

- Every recommendation is editable.
- Rationale and uncertainty notes are shown next to the editable value.
- Suggested and approved values are visible side by side.
- Execution controls stay separated from recommendation approval.

# 6. Implementation Plan

1. Establish backend data model, API, and workflow catalog.
2. Implement recommendation engine with knowledge retrieval and audit logging.
3. Implement SSH execution and VASP input generation.
4. Build the lightweight Next.js review interface.
5. Add ASE-based execution and future calculator extension points.
6. Add setup docs and future extension guidance.

# 7. Code Overview

## Backend

- `backend/app/core/workflow_catalog.py`
  - configurable stage definitions
- `backend/app/services/recommendation_engine.py`
  - stage-aware recommendation generation and approval handling
- `backend/app/services/ase_execution.py`
  - ASE-first execution orchestration and status refresh
- `backend/app/services/ase_vasp.py`
  - maps approved workflow parameters into ASE VASP calculator kwargs
- `backend/app/services/ssh_execution.py`
  - SSH connection testing, submission, and status refresh
- `backend/app/services/vasp_inputs.py`
  - input-file and job-script generation
- `backend/app/api/routes/*.py`
  - FastAPI endpoint surface

## Frontend

- `frontend/app/page.tsx`
  - dashboard and session creation
- `frontend/app/sessions/[sessionId]/page.tsx`
  - session-specific review page
- `frontend/components/workflow-wizard.tsx`
  - recommendation, approval, validation, and execution UI
- `frontend/components/connection-form.tsx`
  - SSH settings UI

# 8. Example Recommendation Flow

1. Create a session for hematite bulk relaxation.
2. Generate recommendations for `incar-recommendation`.
3. Engine suggests `ENCUT=520`, `PREC=Accurate`, `EDIFF=1e-5`, `ISPIN=2`, and a human-reviewed `LDAU` note for oxide behavior.
4. User changes `ISIF` or DFT+U details if needed.
5. Approved values are stored separately from suggested values.

# 9. Example Remote Execution Flow

1. User approves `INCAR`, `KPOINTS`, and `submission-prep`.
2. Backend maps approved parameters into ASE VASP calculator kwargs.
3. Backend writes an ASE run spec and starts a background worker.
4. The worker instantiates `ase.calculators.vasp.Vasp`, loads the POSCAR into `Atoms`, and triggers the calculation.
5. `ase-result.json`, `vasp.out`, and the final structure are stored in the run directory.

The older SSH path remains available when a cluster script submission is still needed.

# 10. Setup And Run

## Backend

1. `python -m venv .venv`
2. `.venv\Scripts\activate`
3. `pip install -r backend/requirements.txt`
4. `copy backend\.env.example backend\.env`
5. `docker compose up -d`
6. `uvicorn app.main:app --reload --app-dir backend`

## Frontend

1. Install Node.js 20+
2. `cd frontend`
3. `copy .env.local.example .env.local`
4. `npm install`
5. `npm run dev`

# 11. Future Improvements

- Replace `Base.metadata.create_all` with Alembic migrations.
- Plug in a real LLM provider abstraction with prompt templates and retrieval-augmented generation.
- Add POSCAR parsing, chemistry-aware validation rules, and richer VASP output review.
- Add vault-based secret storage and more robust background task workers.
- Expand scheduler support and output retrieval for larger research environments.
- Add more ASE calculators so MLIPs and DFT backends can share the same execution contract.
