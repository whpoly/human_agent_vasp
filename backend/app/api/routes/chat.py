from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.chat import ConversationMessage
from app.models.workflow import WorkflowSession
from app.schemas.chat import ConversationMessageCreate, ConversationMessageRead
from app.services.audit import log_event


router = APIRouter(prefix="/workflow-sessions/{session_id}/chat", tags=["chat"])


@router.get("", response_model=list[ConversationMessageRead])
def list_chat_messages(session_id: str, db: Session = Depends(get_db)) -> list[ConversationMessage]:
    session = db.get(WorkflowSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Workflow session not found")

    stmt = (
        select(ConversationMessage)
        .where(ConversationMessage.session_id == session_id)
        .order_by(ConversationMessage.created_at.asc())
    )
    return list(db.scalars(stmt).all())


@router.post("", response_model=ConversationMessageRead, status_code=status.HTTP_201_CREATED)
def create_chat_message(
    session_id: str,
    payload: ConversationMessageCreate,
    db: Session = Depends(get_db),
) -> ConversationMessage:
    session = db.get(WorkflowSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Workflow session not found")

    role = payload.role.strip().lower()
    if role not in {"user", "assistant", "system"}:
        raise HTTPException(status_code=400, detail="role must be one of: user, assistant, system")

    message = ConversationMessage(
        session_id=session_id,
        step_id=payload.step_id,
        role=role,
        content=payload.content.strip(),
        stage_key=payload.stage_key,
        metadata_json=payload.metadata_json,
        created_at=datetime.now(timezone.utc),
    )
    db.add(message)
    db.flush()
    log_event(
        db,
        entity_type="conversation_message",
        entity_id=message.id,
        action="chat_message_created",
        actor_type=role,
        details={
            "session_id": session_id,
            "stage_key": payload.stage_key,
            "step_id": payload.step_id,
        },
    )
    db.commit()
    db.refresh(message)
    return message
