from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.db.session import get_db
from app.models.workflow import WorkflowSession, WorkflowStep
from app.schemas.workflow import (
    RecommendationRequest,
    StepApprovalRequest,
    StepValidationRequest,
    WorkflowSessionCreate,
    WorkflowSessionRead,
    WorkflowSessionUpdate,
    WorkflowStepRead,
)
from app.services.audit import log_event
from app.services.knowledge_base import KnowledgeBaseService
from app.services.recommendation_engine import RecommendationEngine


router = APIRouter(prefix="/workflow-sessions", tags=["workflow-sessions"])


def _session_query() -> list:
    return [
        joinedload(WorkflowSession.steps).joinedload(WorkflowStep.parameters),
        joinedload(WorkflowSession.steps).joinedload(WorkflowStep.revisions),
    ]


@router.get("", response_model=list[WorkflowSessionRead])
def list_workflow_sessions(db: Session = Depends(get_db)) -> list[WorkflowSession]:
    stmt = select(WorkflowSession).options(*_session_query()).order_by(WorkflowSession.created_at.desc())
    return list(db.scalars(stmt).unique().all())


@router.post("", response_model=WorkflowSessionRead, status_code=status.HTTP_201_CREATED)
def create_workflow_session(payload: WorkflowSessionCreate, db: Session = Depends(get_db)) -> WorkflowSession:
    session = WorkflowSession(**payload.model_dump())
    db.add(session)
    db.flush()

    engine = RecommendationEngine(db)
    engine.ensure_workflow_steps(session)
    log_event(
        db,
        entity_type="workflow_session",
        entity_id=session.id,
        action="workflow_session_created",
        actor_type="human",
        details={"title": session.title, "calculation_type": session.calculation_type},
    )
    db.commit()
    return db.scalar(select(WorkflowSession).options(*_session_query()).where(WorkflowSession.id == session.id))


@router.get("/{session_id}", response_model=WorkflowSessionRead)
def get_workflow_session(session_id: str, db: Session = Depends(get_db)) -> WorkflowSession:
    stmt = select(WorkflowSession).options(*_session_query()).where(WorkflowSession.id == session_id)
    session = db.scalar(stmt)
    if not session:
        raise HTTPException(status_code=404, detail="Workflow session not found")
    return session


@router.patch("/{session_id}", response_model=WorkflowSessionRead)
def update_workflow_session(
    session_id: str,
    payload: WorkflowSessionUpdate,
    db: Session = Depends(get_db),
) -> WorkflowSession:
    session = db.get(WorkflowSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Workflow session not found")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(session, key, value)

    log_event(
        db,
        entity_type="workflow_session",
        entity_id=session.id,
        action="workflow_session_updated",
        actor_type="human",
        details=payload.model_dump(exclude_unset=True),
    )
    db.commit()
    return db.scalar(select(WorkflowSession).options(*_session_query()).where(WorkflowSession.id == session.id))


@router.post("/{session_id}/recommendations", response_model=WorkflowStepRead)
def generate_stage_recommendations(
    session_id: str,
    payload: RecommendationRequest,
    db: Session = Depends(get_db),
) -> WorkflowStep:
    session = db.scalar(select(WorkflowSession).options(*_session_query()).where(WorkflowSession.id == session_id))
    if not session:
        raise HTTPException(status_code=404, detail="Workflow session not found")

    engine = RecommendationEngine(db)
    try:
        step = engine.generate_recommendations(session, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    db.commit()
    return db.scalar(
        select(WorkflowStep)
        .options(joinedload(WorkflowStep.parameters), joinedload(WorkflowStep.revisions))
        .where(WorkflowStep.id == step.id)
    )


@router.post("/{session_id}/steps/{step_id}/approve", response_model=WorkflowStepRead)
def approve_workflow_step(
    session_id: str,
    step_id: str,
    payload: StepApprovalRequest,
    db: Session = Depends(get_db),
) -> WorkflowStep:
    step = db.scalar(
        select(WorkflowStep)
        .options(joinedload(WorkflowStep.parameters), joinedload(WorkflowStep.revisions), joinedload(WorkflowStep.session))
        .where(WorkflowStep.id == step_id, WorkflowStep.session_id == session_id)
    )
    if not step:
        raise HTTPException(status_code=404, detail="Workflow step not found")

    engine = RecommendationEngine(db)
    updated = engine.approve_step(
        step,
        parameters=[item.model_dump() for item in payload.parameters],
        note=payload.note,
        mark_validated=payload.mark_validated,
    )

    if payload.mark_validated:
        session = db.get(WorkflowSession, session_id)
        if session:
            KnowledgeBaseService(db).promote_validated_step(
                session=session,
                step=updated,
                trust_score=0.8,
                validation_note=payload.note,
            )

    db.commit()
    return db.scalar(
        select(WorkflowStep)
        .options(joinedload(WorkflowStep.parameters), joinedload(WorkflowStep.revisions))
        .where(WorkflowStep.id == updated.id)
    )


@router.post("/{session_id}/steps/{step_id}/validate", response_model=WorkflowStepRead)
def validate_workflow_step(
    session_id: str,
    step_id: str,
    payload: StepValidationRequest,
    db: Session = Depends(get_db),
) -> WorkflowStep:
    step = db.scalar(
        select(WorkflowStep)
        .options(joinedload(WorkflowStep.parameters), joinedload(WorkflowStep.revisions), joinedload(WorkflowStep.session))
        .where(WorkflowStep.id == step_id, WorkflowStep.session_id == session_id)
    )
    if not step:
        raise HTTPException(status_code=404, detail="Workflow step not found")

    session = db.get(WorkflowSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Workflow session not found")

    step.validated = True
    step.status = "validated"
    KnowledgeBaseService(db).promote_validated_step(
        session=session,
        step=step,
        trust_score=payload.trust_score,
        validation_note=payload.validation_note,
    )
    log_event(
        db,
        entity_type="workflow_step",
        entity_id=step.id,
        action="step_validated",
        actor_type="human",
        details=payload.model_dump(),
    )
    db.commit()
    return db.scalar(
        select(WorkflowStep)
        .options(joinedload(WorkflowStep.parameters), joinedload(WorkflowStep.revisions))
        .where(WorkflowStep.id == step.id)
    )

