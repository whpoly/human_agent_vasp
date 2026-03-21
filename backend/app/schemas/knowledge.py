from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import APIModel


class KnowledgeSearchRequest(BaseModel):
    stage_key: str
    calculation_type: str | None = None
    material_system: str | None = None
    task_goal: str | None = None
    top_k: int = Field(default=5, ge=1, le=20)


class KnowledgeEntryRead(APIModel):
    id: str
    source_session_id: str | None
    source_step_id: str | None
    material_system: str | None
    calculation_type: str
    stage_key: str
    task_goal: str
    validated: bool
    trust_score: float
    validation_note: str | None
    parameter_snapshot: dict
    outcome_summary: dict | None
    provenance: dict | None
    embedding: list[float] | None
    created_at: datetime
    updated_at: datetime
