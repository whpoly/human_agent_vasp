from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.audit import AuditLog


def log_event(
    db: Session,
    *,
    entity_type: str,
    entity_id: str,
    action: str,
    actor_type: str,
    details: dict,
    actor_id: str | None = None,
) -> AuditLog:
    event = AuditLog(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        actor_type=actor_type,
        actor_id=actor_id,
        details=details,
        created_at=datetime.now(timezone.utc),
    )
    db.add(event)
    return event

