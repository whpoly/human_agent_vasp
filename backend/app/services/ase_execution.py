from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.execution import ExecutionRecord
from app.models.workflow import WorkflowSession
from app.services.ase_vasp import build_ase_vasp_run_spec, read_run_result, write_run_spec
from app.services.audit import log_event


class ASEExecutionService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.settings = get_settings()

    def submit_execution(
        self,
        *,
        session: WorkflowSession,
        launch_command: str | None,
        calculator_name: str = "vasp",
        working_directory: str | None = None,
        step_id: str | None = None,
    ) -> ExecutionRecord:
        if calculator_name != "vasp":
            raise ValueError("Only the ASE VASP calculator is supported in the current MVP.")
        if not session.structure_text:
            raise ValueError("ASE VASP execution requires structure_text or POSCAR content in the workflow session.")

        execution = ExecutionRecord(
            session_id=session.id,
            step_id=step_id,
            connection_profile_id=None,
            executor_type="ase:vasp",
            status="created",
            remote_path="",
        )
        self.db.add(execution)
        self.db.flush()

        workdir = self._build_workdir(session.id, execution.id, working_directory)
        spec_path = workdir / "ase-run-spec.json"
        spec = build_ase_vasp_run_spec(
            session,
            execution_id=execution.id,
            workdir=str(workdir),
            launch_command=launch_command,
        )
        write_run_spec(spec, spec_path)

        stdout_path = workdir / "runner.stdout.log"
        stderr_path = workdir / "runner.stderr.log"
        process = self._spawn_runner(spec_path, stdout_path, stderr_path)

        execution.status = "submitted"
        execution.remote_job_id = str(process.pid)
        execution.remote_path = str(workdir)
        execution.submission_command = f"{sys.executable} -m app.workers.ase_runner {spec_path.name}"
        execution.status_command = str(workdir / "ase-result.json")
        execution.input_manifest = {
            "calculator_name": calculator_name,
            "spec_file": spec_path.name,
            "warnings": spec["warnings"],
        }
        execution.stdout_excerpt = ""
        execution.stderr_excerpt = ""
        execution.submitted_at = datetime.now(timezone.utc)

        session.status = "running"
        log_event(
            self.db,
            entity_type="execution_record",
            entity_id=execution.id,
            action="execution_submitted",
            actor_type="human",
            details={
                "session_id": session.id,
                "execution_backend": "ase",
                "calculator_name": calculator_name,
                "pid": process.pid,
                "workdir": str(workdir),
            },
        )
        return execution

    def refresh_execution(self, execution: ExecutionRecord) -> ExecutionRecord:
        workdir = Path(execution.remote_path)
        result_path = workdir / "ase-result.json"
        stdout_path = workdir / "runner.stdout.log"
        stderr_path = workdir / "runner.stderr.log"
        vasp_stdout_path = workdir / "vasp.out"

        result = read_run_result(result_path)
        if result is not None:
            execution.status = str(result.get("status", execution.status))
            execution.output_manifest = self._summarize_result(result)
            execution.stdout_excerpt = self._tail_text(vasp_stdout_path) or self._tail_text(stdout_path)
            execution.stderr_excerpt = self._tail_text(stderr_path)
            if execution.status in {"completed", "failed"} and execution.completed_at is None:
                execution.completed_at = datetime.now(timezone.utc)
            return execution

        execution.stdout_excerpt = self._tail_text(stdout_path)
        execution.stderr_excerpt = self._tail_text(stderr_path)

        if execution.remote_job_id and not self._is_process_running(int(execution.remote_job_id)):
            execution.status = "failed"
            execution.completed_at = execution.completed_at or datetime.now(timezone.utc)
            execution.stderr_excerpt = (
                execution.stderr_excerpt or "ASE worker exited before writing ase-result.json."
            )
        else:
            execution.status = "running"
        return execution

    def _build_workdir(self, session_id: str, execution_id: str, override: str | None) -> Path:
        if override:
            path = Path(override)
        else:
            path = Path(self.settings.ase_run_root) / session_id / execution_id
        path.mkdir(parents=True, exist_ok=True)
        return path.resolve()

    def _spawn_runner(self, spec_path: Path, stdout_path: Path, stderr_path: Path) -> subprocess.Popen[str]:
        backend_root = Path(__file__).resolve().parents[2]
        env = os.environ.copy()
        existing_pythonpath = env.get("PYTHONPATH")
        env["PYTHONPATH"] = (
            str(backend_root)
            if not existing_pythonpath
            else os.pathsep.join([str(backend_root), existing_pythonpath])
        )

        stdout_handle = stdout_path.open("w", encoding="utf-8")
        stderr_handle = stderr_path.open("w", encoding="utf-8")
        try:
            process = subprocess.Popen(
                [sys.executable, "-m", "app.workers.ase_runner", str(spec_path)],
                cwd=str(backend_root),
                env=env,
                stdout=stdout_handle,
                stderr=stderr_handle,
                text=True,
            )
            return process
        except Exception:
            stdout_handle.close()
            stderr_handle.close()
            raise
        finally:
            stdout_handle.close()
            stderr_handle.close()

    def _tail_text(self, path: Path, limit: int = 4000) -> str:
        if not path.exists():
            return ""
        return path.read_text(encoding="utf-8", errors="replace")[-limit:]

    def _is_process_running(self, pid: int) -> bool:
        if pid <= 0:
            return False
        if os.name == "nt":
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}"],
                capture_output=True,
                text=True,
                check=False,
            )
            return str(pid) in result.stdout
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        return True

    def _summarize_result(self, result: dict) -> dict:
        status = str(result.get("status", "unknown"))
        energy = result.get("energy_ev")
        if energy is None:
            energy = result.get("energy")

        max_force = None
        forces = result.get("forces")
        if isinstance(forces, list) and forces:
            candidates: list[float] = []
            for item in forces:
                if isinstance(item, list) and len(item) >= 3:
                    try:
                        magnitude = float(item[0]) ** 2 + float(item[1]) ** 2 + float(item[2]) ** 2
                        candidates.append(magnitude ** 0.5)
                    except Exception:
                        continue
            if candidates:
                max_force = max(candidates)

        return {
            "status": status,
            "energy_ev": energy,
            "max_force_ev_per_ang": max_force,
            "converged": status == "completed",
            "error": result.get("error"),
        }
