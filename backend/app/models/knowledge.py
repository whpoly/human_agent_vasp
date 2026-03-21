from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class KnowledgeEntry(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "knowledge_entries"

    source_session_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("workflow_sessions.id"),
        nullable=True,
    )
    source_step_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("workflow_steps.id"),
        nullable=True,
    )
    material_system: Mapped[str | None] = mapped_column(String(255), nullable=True)
    calculation_type: Mapped[str] = mapped_column(String(120))
    stage_key: Mapped[str] = mapped_column(String(100))
    task_goal: Mapped[str] = mapped_column(Text)
    validated: Mapped[bool] = mapped_column(Boolean, default=False)
    trust_score: Mapped[float] = mapped_column(Float, default=0.5)
    validation_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    parameter_snapshot: Mapped[dict] = mapped_column(JSON)
    outcome_summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    provenance: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    embedding: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)

