from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.schemas.common import APIModel


class ExecutionCreateRequest(BaseModel):
    execution_backend: str = "ase"
    calculator_name: str = "vasp"
    connection_profile_id: str | None = None
    scheduler_overrides: dict | None = None
    launch_command: str | None = None
    step_id: str | None = None
    working_directory: str | None = None


class ExecutionStatusRefreshRequest(BaseModel):
    connection_password: str | None = None


class ExecutionRead(APIModel):
    id: str
    session_id: str
    step_id: str | None
    connection_profile_id: str | None
    executor_type: str
    status: str
    remote_job_id: str | None
    remote_path: str
    submission_command: str | None
    status_command: str | None
    input_manifest: dict | None
    output_manifest: dict | None
    stdout_excerpt: str | None
    stderr_excerpt: str | None
    submitted_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
