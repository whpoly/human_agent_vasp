from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.db.session import get_db
from app.models.execution import ExecutionRecord
from app.models.ssh_connection import SSHConnectionProfile
from app.models.workflow import WorkflowSession, WorkflowStep
from app.schemas.execution import ExecutionCreateRequest, ExecutionRead, ExecutionStatusRefreshRequest
from app.services.ase_execution import ASEExecutionService
from app.services.ssh_execution import SSHExecutionService
from app.services.vasp_inputs import collect_approved_parameters


router = APIRouter(prefix="/workflow-sessions/{session_id}/executions", tags=["executions"])


@router.get("", response_model=list[ExecutionRead])
def list_executions(session_id: str, db: Session = Depends(get_db)) -> list[ExecutionRecord]:
    stmt = (
        select(ExecutionRecord)
        .where(ExecutionRecord.session_id == session_id)
        .order_by(ExecutionRecord.created_at.desc())
    )
    return list(db.scalars(stmt).all())


@router.post("", response_model=ExecutionRead, status_code=status.HTTP_201_CREATED)
def submit_execution(
    session_id: str,
    payload: ExecutionCreateRequest,
    db: Session = Depends(get_db),
) -> ExecutionRecord:
    session = db.scalar(
        select(WorkflowSession)
        .options(joinedload(WorkflowSession.steps).joinedload(WorkflowStep.parameters))
        .where(WorkflowSession.id == session_id)
    )
    if not session:
        raise HTTPException(status_code=404, detail="Workflow session not found")

    approved = collect_approved_parameters(session)
    if "parameter-confirmation" not in approved and "incar-recommendation" not in approved:
        raise HTTPException(status_code=400, detail="Execution requires approved parameters")

    backend = payload.execution_backend.lower().strip()
    submission_params = approved.get("calculation-submit") or approved.get("submission-prep", {})
    launch_command = payload.launch_command or submission_params.get("launch_command", "vasp_std")
    try:
        if backend == "ase":
            service = ASEExecutionService(db)
            execution = service.submit_execution(
                session=session,
                launch_command=launch_command,
                calculator_name=payload.calculator_name,
                working_directory=payload.working_directory,
                step_id=payload.step_id,
            )
        elif backend == "ssh":
            if payload.connection_profile_id:
                session.connection_profile_id = payload.connection_profile_id

            connection_id = session.connection_profile_id
            if not connection_id:
                raise HTTPException(status_code=400, detail="SSH execution requires a connection profile")

            connection = db.get(SSHConnectionProfile, connection_id)
            if not connection:
                raise HTTPException(status_code=404, detail="Connection profile not found")

            service = SSHExecutionService(db)
            execution = service.submit_execution(
                session=session,
                connection=connection,
                launch_command=launch_command,
                scheduler_overrides=payload.scheduler_overrides,
                step_id=payload.step_id,
            )
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported execution backend: {payload.execution_backend}")
        db.commit()
        return execution
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:  # pragma: no cover
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Execution submission failed: {exc}") from exc


@router.post("/{execution_id}/refresh", response_model=ExecutionRead)
def refresh_execution_status(
    session_id: str,
    execution_id: str,
    payload: ExecutionStatusRefreshRequest,
    db: Session = Depends(get_db),
) -> ExecutionRecord:
    _ = payload
    session = db.get(WorkflowSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Workflow session not found")

    execution = db.get(ExecutionRecord, execution_id)
    if not execution or execution.session_id != session_id:
        raise HTTPException(status_code=404, detail="Execution record not found")

    try:
        if execution.executor_type.startswith("ase:"):
            refreshed = ASEExecutionService(db).refresh_execution(execution)
        else:
            if not session.connection_profile_id:
                raise HTTPException(status_code=404, detail="Connection profile not found")
            connection = db.get(SSHConnectionProfile, session.connection_profile_id)
            if not connection:
                raise HTTPException(status_code=404, detail="Connection profile not found")
            refreshed = SSHExecutionService(db).refresh_execution(connection, execution)
        db.commit()
        return refreshed
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:  # pragma: no cover
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Execution status refresh failed: {exc}") from exc
