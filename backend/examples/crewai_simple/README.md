# CrewAI + ASE Remote VASP Minimal Example

This is a minimal, single-run pipeline for your exact simplified use case:

1. Read a structure file.
2. Query an external DB for validated historical parameters.
3. Ask a CrewAI parameter agent to recommend VASP settings.
4. Let the human confirm or override the recommendation.
5. Use SSH to run ASE+VASP on one remote terminal machine.
6. Parse useful outputs and persist them to the external DB.

## What this example intentionally does

- Keeps workflow simple (single script).
- Uses `CrewAI` for recommendation orchestration.
- Uses `ASE` for VASP calculator interface.
- Uses external DB tables (`validated_param_sets`, `run_records`) for memory and traceability.
- Forces recommendation to look up DB history before LLM recommendation.

## What this example does not try to do

- No frontend.
- No multi-step orchestration.
- No scheduler abstraction.
- No advanced chemistry validation.

## Prerequisites

- Remote machine has:
  - `python3`
  - `ase`
  - VASP executable in command path or module environment
- Local machine has network SSH access to remote machine.
- External DB is reachable (PostgreSQL recommended, SQLite also works with SQLAlchemy URL).
- If using CrewAI with OpenAI model, set `OPENAI_API_KEY`.

## Setup

```powershell
cd backend/examples/crewai_simple
pip install -r requirements.txt
```

Copy config template and edit:

```powershell
copy config.example.json config.json
```

Set remote SSH password env if using password auth:

```powershell
$env:REMOTE_SSH_PASSWORD="your_password_here"
```

## Run

```powershell
python run_pipeline.py --config config.json --structure C:\path\to\your\structure.vasp
```

You will see:

1. historical DB count
2. CrewAI recommendation JSON
3. optional manual JSON override prompt
4. remote execution and polling
5. parsed useful output summary

Outputs are downloaded to:

`backend/examples/crewai_simple/output/<run_id>/`

## External DB behavior

- Before recommending:
  - query `validated_param_sets` by `system_tag + calculation_type`
- After confirmation:
  - save final confirmed params to `validated_param_sets`
- After run:
  - save status and useful outputs to `run_records`

This gives you a minimal retrieval-before-generation loop from day one.
