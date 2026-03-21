from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class AuditLogRead(APIModel):
    id: str
    entity_type: str
    entity_id: str
    action: str
    actor_type: str
    actor_id: str | None = None
    details: dict
    created_at: datetime

