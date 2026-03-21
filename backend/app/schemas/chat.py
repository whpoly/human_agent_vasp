from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.schemas.common import APIModel


class ConversationMessageCreate(BaseModel):
    role: str
    content: str
    step_id: str | None = None
    stage_key: str | None = None
    metadata_json: dict | None = None


class ConversationMessageRead(APIModel):
    id: str
    session_id: str
    step_id: str | None
    role: str
    content: str
    stage_key: str | None
    metadata_json: dict | None
    created_at: datetime

