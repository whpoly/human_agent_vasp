from __future__ import annotations

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.models.knowledge import KnowledgeEntry
from app.models.workflow import WorkflowSession, WorkflowStep


class KnowledgeBaseService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def retrieve_similar_cases(
        self,
        *,
        stage_key: str,
        calculation_type: str | None,
        material_system: str | None,
        task_goal: str | None,
        top_k: int = 5,
    ) -> list[KnowledgeEntry]:
        stmt = select(KnowledgeEntry).where(
            KnowledgeEntry.stage_key == stage_key,
            KnowledgeEntry.validated.is_(True),
        )
        if calculation_type:
            stmt = stmt.where(KnowledgeEntry.calculation_type == calculation_type)
        if material_system:
            stmt = stmt.where(KnowledgeEntry.material_system == material_system)
        stmt = stmt.order_by(desc(KnowledgeEntry.trust_score), desc(KnowledgeEntry.created_at)).limit(top_k)
        entries = list(self.db.scalars(stmt).all())

        if entries or not task_goal:
            return entries

        fallback_stmt = (
            select(KnowledgeEntry)
            .where(KnowledgeEntry.stage_key == stage_key, KnowledgeEntry.validated.is_(True))
            .order_by(desc(KnowledgeEntry.trust_score), desc(KnowledgeEntry.created_at))
            .limit(top_k)
        )
        return list(self.db.scalars(fallback_stmt).all())

    def promote_validated_step(
        self,
        *,
        session: WorkflowSession,
        step: WorkflowStep,
        trust_score: float,
        validation_note: str | None,
    ) -> KnowledgeEntry:
        parameter_snapshot = {
            parameter.name: {
                "suggested": parameter.suggested_value,
                "approved": parameter.approved_value,
                "rationale": parameter.rationale,
            }
            for parameter in step.parameters
        }
        entry = KnowledgeEntry(
            source_session_id=session.id,
            source_step_id=step.id,
            material_system=session.material_system,
            calculation_type=session.calculation_type,
            stage_key=step.stage_key,
            task_goal=session.goal,
            validated=True,
            trust_score=trust_score,
            validation_note=validation_note,
            parameter_snapshot=parameter_snapshot,
            outcome_summary={
                "step_status": step.status,
                "warnings": step.warnings or [],
            },
            provenance={
                "session_title": session.title,
                "approved_at": step.approved_at.isoformat() if step.approved_at else None,
            },
        )
        self.db.add(entry)
        return entry

