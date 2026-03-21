from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class WorkflowSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "workflow_sessions"

    title: Mapped[str] = mapped_column(String(255))
    goal: Mapped[str] = mapped_column(Text)
    material_system: Mapped[str | None] = mapped_column(String(255), nullable=True)
    calculation_type: Mapped[str] = mapped_column(String(100), default="relaxation")
    status: Mapped[str] = mapped_column(String(50), default="draft")
    current_stage_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    constraints: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    structure_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    connection_profile_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("ssh_connection_profiles.id"),
        nullable=True,
    )

    steps: Mapped[list["WorkflowStep"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="WorkflowStep.stage_index",
    )
    executions: Mapped[list["ExecutionRecord"]] = relationship(back_populates="session")


class WorkflowStep(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "workflow_steps"

    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("workflow_sessions.id"))
    stage_key: Mapped[str] = mapped_column(String(100))
    stage_name: Mapped[str] = mapped_column(String(255))
    stage_index: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    context_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    recommendation_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    warnings: Mapped[list | None] = mapped_column(JSON, nullable=True)
    user_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    validated: Mapped[bool] = mapped_column(Boolean, default=False)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    session: Mapped["WorkflowSession"] = relationship(back_populates="steps")
    parameters: Mapped[list["StepParameter"]] = relationship(
        back_populates="step",
        cascade="all, delete-orphan",
        order_by="StepParameter.name",
    )
    revisions: Mapped[list["StepRevision"]] = relationship(
        back_populates="step",
        cascade="all, delete-orphan",
        order_by="StepRevision.version_number",
    )
    executions: Mapped[list["ExecutionRecord"]] = relationship(back_populates="step")


class StepParameter(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "step_parameters"

    step_id: Mapped[str] = mapped_column(String(36), ForeignKey("workflow_steps.id"))
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    suggested_value: Mapped[dict | str | int | float | bool | list | None] = mapped_column(JSON, nullable=True)
    edited_value: Mapped[dict | str | int | float | bool | list | None] = mapped_column(JSON, nullable=True)
    approved_value: Mapped[dict | str | int | float | bool | list | None] = mapped_column(JSON, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(50), nullable=True)
    rationale: Mapped[str] = mapped_column(Text)
    uncertainty_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)

    step: Mapped["WorkflowStep"] = relationship(back_populates="parameters")


class StepRevision(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "step_revisions"

    step_id: Mapped[str] = mapped_column(String(36), ForeignKey("workflow_steps.id"))
    version_number: Mapped[int] = mapped_column(Integer)
    actor_type: Mapped[str] = mapped_column(String(50))
    action: Mapped[str] = mapped_column(String(120))
    payload: Mapped[dict] = mapped_column(JSON)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    step: Mapped["WorkflowStep"] = relationship(back_populates="revisions")

