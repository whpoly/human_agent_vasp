from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import APIModel


class ParameterOverride(BaseModel):
    name: str
    approved_value: dict | str | int | float | bool | list | None = None
    edited_value: dict | str | int | float | bool | list | None = None
    rationale: str | None = None
    uncertainty_note: str | None = None


class ParameterRecommendationRead(APIModel):
    id: str
    name: str
    category: str | None
    suggested_value: dict | str | int | float | bool | list | None
    edited_value: dict | str | int | float | bool | list | None
    approved_value: dict | str | int | float | bool | list | None
    unit: str | None
    rationale: str
    uncertainty_note: str | None
    source_metadata: dict | None
    is_locked: bool


class StepRevisionRead(APIModel):
    id: str
    version_number: int
    actor_type: str
    action: str
    payload: dict
    note: str | None
    created_at: datetime


class WorkflowStepRead(APIModel):
    id: str
    session_id: str
    stage_key: str
    stage_name: str
    stage_index: int
    status: str
    context_snapshot: dict | None
    recommendation_summary: str | None
    warnings: list | None
    user_notes: str | None
    validated: bool
    approved_at: datetime | None
    created_at: datetime
    updated_at: datetime
    parameters: list[ParameterRecommendationRead]
    revisions: list[StepRevisionRead]


class WorkflowSessionCreate(BaseModel):
    title: str
    goal: str
    material_system: str | None = None
    calculation_type: str = "relaxation"
    constraints: dict | None = None
    structure_text: str | None = None
    user_notes: str | None = None
    connection_profile_id: str | None = None


class WorkflowSessionUpdate(BaseModel):
    title: str | None = None
    goal: str | None = None
    material_system: str | None = None
    calculation_type: str | None = None
    status: str | None = None
    current_stage_key: str | None = None
    constraints: dict | None = None
    structure_text: str | None = None
    user_notes: str | None = None
    connection_profile_id: str | None = None


class WorkflowSessionRead(APIModel):
    id: str
    title: str
    goal: str
    material_system: str | None
    calculation_type: str
    status: str
    current_stage_key: str | None
    constraints: dict | None
    structure_text: str | None
    user_notes: str | None
    connection_profile_id: str | None
    created_at: datetime
    updated_at: datetime
    steps: list[WorkflowStepRead]


class RecommendationRequest(BaseModel):
    stage_key: str
    user_intent: str | None = None
    constraints: dict | None = None
    draft_parameters: dict[str, dict | str | int | float | bool | list | None] | None = None
    user_feedback: str | None = None


class StepApprovalRequest(BaseModel):
    parameters: list[ParameterOverride]
    note: str | None = None
    mark_validated: bool = False


class StepValidationRequest(BaseModel):
    validation_note: str | None = None
    trust_score: float = Field(default=0.8, ge=0.0, le=1.0)

