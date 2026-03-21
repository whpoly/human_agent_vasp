from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ExecutionRecord(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "execution_records"

    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("workflow_sessions.id"))
    step_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("workflow_steps.id"), nullable=True)
    connection_profile_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("ssh_connection_profiles.id"),
        nullable=True,
    )
    executor_type: Mapped[str] = mapped_column(String(30), default="direct")
    status: Mapped[str] = mapped_column(String(50), default="created")
    remote_job_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    remote_path: Mapped[str] = mapped_column(Text)
    submission_command: Mapped[str | None] = mapped_column(Text, nullable=True)
    status_command: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_manifest: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    output_manifest: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    stdout_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    stderr_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    session: Mapped["WorkflowSession"] = relationship(back_populates="executions")
    step: Mapped["WorkflowStep"] = relationship(back_populates="executions")
    connection_profile: Mapped["SSHConnectionProfile | None"] = relationship(back_populates="executions")
