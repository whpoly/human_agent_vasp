# VASP Human-in-the-Loop Agent MVP

This repository contains a production-oriented MVP for a human-in-the-loop agent system that assists with VASP-based DFT workflows. The product is intentionally designed to keep scientists in control: the agent recommends parameters, preserves rationale and provenance, and requires explicit human approval before anything is executed. The backend now supports ASE-based VASP execution so future MLIP calculators can fit into the same orchestration path.

## What is included

- `backend/`: FastAPI API with workflow orchestration, recommendation engine, SSH execution abstraction, audit logging, and knowledge-base retrieval.
- `frontend/`: Next.js app for workflow creation, step review, parameter editing, approval, SSH connection setup, and execution monitoring.
- `docs/`: Architecture, data model, API, workflow, and implementation notes.
- `docker-compose.yml`: Local PostgreSQL + pgvector-compatible development database.
- Frontend quick run checklist: [docs/frontend-run-checklist.md](docs/frontend-run-checklist.md)

## Backend setup

1. Create a Python virtual environment.
2. Install dependencies with `pip install -r backend/requirements.txt`.
3. Copy `backend/.env.example` to `backend/.env` and adjust connection strings and secrets.
4. Start PostgreSQL with `docker compose up -d`.
5. Run the API with `uvicorn app.main:app --reload --app-dir backend`.

The API exposes OpenAPI docs at `http://localhost:8000/docs`.

### ASE execution notes

- The default execution backend is now `ASE`, using `ase.calculators.vasp.Vasp`.
- Set `ASE_VASP_COMMAND` in `backend/.env` or provide a `launch_command` in the approved `submission-prep` stage.
- ASE runs are written beneath `ASE_RUN_ROOT` and produce an `ase-run-spec.json`, `ase-result.json`, `vasp.out`, and final structure files.
- The older SSH execution path is still available for compatibility, but ASE is the preferred backend for future calculator abstraction.

## Frontend setup

1. Install Node.js 20+.
2. In `frontend/`, install dependencies with `npm install`.
3. Copy `frontend/.env.local.example` to `frontend/.env.local`.
4. Run the app with `npm run dev`.

The frontend expects the backend at `http://localhost:8000/api/v1` by default.

## Simplified CrewAI example

If you want a minimal single-run workflow using one remote machine, one structure file, and an external DB, use:

- [backend/examples/crewai_simple/README.md](backend/examples/crewai_simple/README.md)
- [backend/examples/crewai_simple/run_pipeline.py](backend/examples/crewai_simple/run_pipeline.py)

## Verification

The backend codebase is designed to be syntax-checkable with `python -m compileall backend/app`. The frontend code is scaffolded but was not executed in this environment because Node.js is not installed here.
