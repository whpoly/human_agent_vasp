from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import APIModel


class SSHConnectionCreate(BaseModel):
    name: str
    host: str
    port: int = 22
    username: str
    auth_method: str = "password"
    password: str | None = None
    ssh_key_path: str | None = None
    remote_workdir: str = "/scratch/vasp-agent"
    scheduler_type: str = "direct"
    scheduler_submit_command: str | None = None
    extra_metadata: dict | None = None


class SSHConnectionTestRequest(BaseModel):
    password: str | None = None


class SSHConnectionRead(APIModel):
    id: str
    name: str
    host: str
    port: int
    username: str
    auth_method: str
    ssh_key_path: str | None
    remote_workdir: str
    scheduler_type: str
    scheduler_submit_command: str | None
    extra_metadata: dict | None
    last_tested_at: datetime | None
    created_at: datetime
    updated_at: datetime
    has_secret: bool = Field(default=False)


class SSHConnectionTestResponse(BaseModel):
    ok: bool
    message: str

