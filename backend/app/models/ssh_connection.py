from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class SSHConnectionProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "ssh_connection_profiles"

    name: Mapped[str] = mapped_column(String(120))
    host: Mapped[str] = mapped_column(String(255))
    port: Mapped[int] = mapped_column(default=22)
    username: Mapped[str] = mapped_column(String(120))
    auth_method: Mapped[str] = mapped_column(String(30), default="password")
    encrypted_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    ssh_key_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    remote_workdir: Mapped[str] = mapped_column(Text)
    scheduler_type: Mapped[str] = mapped_column(String(30), default="direct")
    scheduler_submit_command: Mapped[str | None] = mapped_column(Text, nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    sessions: Mapped[list["WorkflowSession"]] = relationship(backref="connection_profile")
    executions: Mapped[list["ExecutionRecord"]] = relationship(back_populates="connection_profile")

