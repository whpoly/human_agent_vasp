from __future__ import annotations

import io
import posixpath
from dataclasses import dataclass
from datetime import datetime, timezone

import paramiko
from sqlalchemy.orm import Session

from app.models.execution import ExecutionRecord
from app.models.ssh_connection import SSHConnectionProfile
from app.models.workflow import WorkflowSession
from app.services.audit import log_event
from app.services.security import SecretsManager
from app.services.vasp_inputs import build_vasp_input_bundle


@dataclass
class CommandResult:
    stdout: str
    stderr: str
    exit_status: int


class ParamikoExecutor:
    def __init__(self, secrets: SecretsManager) -> None:
        self.secrets = secrets

    def test_connection(self, connection: SSHConnectionProfile, password_override: str | None = None) -> tuple[bool, str]:
        client = self._connect(connection, password_override)
        try:
            result = self._run(client, "pwd")
            return result.exit_status == 0, result.stdout.strip() or "Connected successfully."
        finally:
            client.close()

    def submit(
        self,
        session: WorkflowSession,
        connection: SSHConnectionProfile,
        execution: ExecutionRecord,
        launch_command: str,
        scheduler_overrides: dict | None = None,
    ) -> ExecutionRecord:
        client = self._connect(connection)
        remote_path = posixpath.join(connection.remote_workdir.rstrip("/"), session.id)
        try:
            self._run(client, f"mkdir -p {remote_path}")
            bundle = build_vasp_input_bundle(
                session,
                scheduler_type=connection.scheduler_type,
                launch_command=launch_command,
                scheduler_overrides=scheduler_overrides,
            )
            self._upload_bundle(client, remote_path, bundle)

            submission_command = self._build_submit_command(connection, remote_path)
            result = self._run(client, submission_command)

            execution.status = "submitted" if result.exit_status == 0 else "failed"
            execution.remote_path = remote_path
            execution.submission_command = submission_command
            execution.status_command = self._build_status_command(connection, execution)
            execution.input_manifest = {"files": list(bundle.keys())}
            execution.stdout_excerpt = result.stdout[-4000:]
            execution.stderr_excerpt = result.stderr[-4000:]
            execution.submitted_at = datetime.now(timezone.utc)

            job_id = self._extract_job_id(result.stdout, connection.scheduler_type)
            execution.remote_job_id = job_id
            if not job_id and connection.scheduler_type == "direct":
                execution.remote_job_id = "interactive-shell"
            return execution
        finally:
            client.close()

    def refresh_status(self, connection: SSHConnectionProfile, execution: ExecutionRecord) -> ExecutionRecord:
        client = self._connect(connection)
        try:
            if not execution.status_command:
                return execution
            result = self._run(client, execution.status_command)
            execution.stdout_excerpt = result.stdout[-4000:]
            execution.stderr_excerpt = result.stderr[-4000:]
            if result.exit_status == 0:
                execution.status = self._interpret_status(result.stdout, connection.scheduler_type)
                if execution.status in {"completed", "failed"}:
                    execution.completed_at = datetime.now(timezone.utc)
            return execution
        finally:
            client.close()

    def _connect(self, connection: SSHConnectionProfile, password_override: str | None = None) -> paramiko.SSHClient:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        password = password_override or self.secrets.decrypt(connection.encrypted_secret)
        client.connect(
            hostname=connection.host,
            port=connection.port,
            username=connection.username,
            password=password if connection.auth_method == "password" else None,
            key_filename=connection.ssh_key_path if connection.auth_method == "ssh_key" else None,
            timeout=10,
            banner_timeout=10,
            auth_timeout=10,
        )
        return client

    def _run(self, client: paramiko.SSHClient, command: str) -> CommandResult:
        stdin, stdout, stderr = client.exec_command(command)
        _ = stdin
        exit_status = stdout.channel.recv_exit_status()
        return CommandResult(
            stdout=stdout.read().decode("utf-8", errors="replace"),
            stderr=stderr.read().decode("utf-8", errors="replace"),
            exit_status=exit_status,
        )

    def _upload_bundle(self, client: paramiko.SSHClient, remote_path: str, bundle: dict[str, str]) -> None:
        with client.open_sftp() as sftp:
            for filename, content in bundle.items():
                with sftp.file(posixpath.join(remote_path, filename), "w") as remote_file:
                    buffer = io.StringIO(content)
                    remote_file.write(buffer.getvalue())

    def _build_submit_command(self, connection: SSHConnectionProfile, remote_path: str) -> str:
        if connection.scheduler_type == "slurm":
            submit = connection.scheduler_submit_command or "sbatch run_job.sh"
            return f"cd {remote_path} && {submit}"
        if connection.scheduler_type == "pbs":
            submit = connection.scheduler_submit_command or "qsub run_job.sh"
            return f"cd {remote_path} && {submit}"
        return f"cd {remote_path} && chmod +x run_job.sh && nohup ./run_job.sh > job.out 2> job.err & echo $!"

    def _build_status_command(self, connection: SSHConnectionProfile, execution: ExecutionRecord) -> str:
        if connection.scheduler_type == "slurm" and execution.remote_job_id:
            return f"squeue -j {execution.remote_job_id}"
        if connection.scheduler_type == "pbs" and execution.remote_job_id:
            return f"qstat {execution.remote_job_id}"
        if execution.remote_path:
            return (
                f"cd {execution.remote_path} && "
                "if [ -f job.err ] && [ -s job.err ]; then echo FAILED && tail -n 50 job.err; "
                "elif [ -f OUTCAR ]; then echo COMPLETED; else echo RUNNING; fi"
            )
        return "echo UNKNOWN"

    def _extract_job_id(self, output: str, scheduler_type: str) -> str | None:
        if scheduler_type in {"slurm", "pbs"}:
            tokens = output.strip().split()
            for token in reversed(tokens):
                if token.replace(".", "").isdigit():
                    return token
            return output.strip() or None
        return None

    def _interpret_status(self, output: str, scheduler_type: str) -> str:
        lowered = output.lower()
        if scheduler_type == "direct":
            if "failed" in lowered:
                return "failed"
            if "completed" in lowered:
                return "completed"
            return "running"
        if not lowered.strip():
            return "completed"
        if any(token in lowered for token in ["running", " pd ", "qw", " q "]):
            return "running"
        return "completed"


class SSHExecutionService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.secrets = SecretsManager()
        self.executor = ParamikoExecutor(self.secrets)

    def test_connection(self, connection: SSHConnectionProfile, password_override: str | None = None) -> tuple[bool, str]:
        return self.executor.test_connection(connection, password_override)

    def submit_execution(
        self,
        *,
        session: WorkflowSession,
        connection: SSHConnectionProfile,
        launch_command: str,
        scheduler_overrides: dict | None = None,
        step_id: str | None = None,
    ) -> ExecutionRecord:
        execution = ExecutionRecord(
            session_id=session.id,
            step_id=step_id,
            connection_profile_id=connection.id,
            executor_type=connection.scheduler_type,
            status="created",
            remote_path=connection.remote_workdir,
        )
        self.db.add(execution)
        self.db.flush()

        execution = self.executor.submit(
            session=session,
            connection=connection,
            execution=execution,
            launch_command=launch_command,
            scheduler_overrides=scheduler_overrides,
        )

        session.status = "running" if execution.status == "submitted" else "execution_failed"
        log_event(
            self.db,
            entity_type="execution_record",
            entity_id=execution.id,
            action="execution_submitted",
            actor_type="human",
            details={
                "session_id": session.id,
                "connection_profile_id": connection.id,
                "status": execution.status,
            },
        )
        return execution

    def refresh_execution(self, connection: SSHConnectionProfile, execution: ExecutionRecord) -> ExecutionRecord:
        refreshed = self.executor.refresh_status(connection, execution)
        log_event(
            self.db,
            entity_type="execution_record",
            entity_id=execution.id,
            action="execution_status_refreshed",
            actor_type="system",
            details={"status": refreshed.status},
        )
        return refreshed
