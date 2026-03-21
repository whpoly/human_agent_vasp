from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.ssh_connection import SSHConnectionProfile
from app.schemas.ssh_connection import (
    SSHConnectionCreate,
    SSHConnectionRead,
    SSHConnectionTestRequest,
    SSHConnectionTestResponse,
)
from app.services.audit import log_event
from app.services.security import SecretsManager
from app.services.ssh_execution import SSHExecutionService


router = APIRouter(prefix="/connections", tags=["connections"])


def _read_model(connection: SSHConnectionProfile) -> SSHConnectionRead:
    return SSHConnectionRead.model_validate(connection).model_copy(
        update={"has_secret": bool(connection.encrypted_secret)}
    )


@router.get("", response_model=list[SSHConnectionRead])
def list_connections(db: Session = Depends(get_db)) -> list[SSHConnectionRead]:
    stmt = select(SSHConnectionProfile).order_by(SSHConnectionProfile.created_at.desc())
    return [_read_model(connection) for connection in db.scalars(stmt).all()]


@router.post("", response_model=SSHConnectionRead, status_code=status.HTTP_201_CREATED)
def create_connection(payload: SSHConnectionCreate, db: Session = Depends(get_db)) -> SSHConnectionRead:
    secrets = SecretsManager()
    profile = SSHConnectionProfile(
        name=payload.name,
        host=payload.host,
        port=payload.port,
        username=payload.username,
        auth_method=payload.auth_method,
        encrypted_secret=secrets.encrypt(payload.password),
        ssh_key_path=payload.ssh_key_path,
        remote_workdir=payload.remote_workdir,
        scheduler_type=payload.scheduler_type,
        scheduler_submit_command=payload.scheduler_submit_command,
        extra_metadata=payload.extra_metadata,
    )
    db.add(profile)
    db.flush()
    log_event(
        db,
        entity_type="ssh_connection_profile",
        entity_id=profile.id,
        action="connection_created",
        actor_type="human",
        details={"host": profile.host, "scheduler_type": profile.scheduler_type},
    )
    db.commit()
    return _read_model(profile)


@router.post("/{connection_id}/test", response_model=SSHConnectionTestResponse)
def test_connection(
    connection_id: str,
    payload: SSHConnectionTestRequest,
    db: Session = Depends(get_db),
) -> SSHConnectionTestResponse:
    connection = db.get(SSHConnectionProfile, connection_id)
    if not connection:
        raise HTTPException(status_code=404, detail="Connection profile not found")

    service = SSHExecutionService(db)
    try:
        ok, message = service.test_connection(connection, payload.password)
    except Exception as exc:  # pragma: no cover
        ok, message = False, str(exc)

    if ok:
        connection.last_tested_at = datetime.now(timezone.utc)
        log_event(
            db,
            entity_type="ssh_connection_profile",
            entity_id=connection.id,
            action="connection_tested",
            actor_type="human",
            details={"ok": True},
        )
        db.commit()
    return SSHConnectionTestResponse(ok=ok, message=message)
