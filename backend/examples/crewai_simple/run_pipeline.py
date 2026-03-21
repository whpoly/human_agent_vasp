from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import tempfile
import time
import traceback
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import paramiko
from ase.io import read, write
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    desc,
    select,
    update,
)

try:
    from crewai import Agent, Crew, Process, Task

    CREWAI_AVAILABLE = True
except Exception:
    CREWAI_AVAILABLE = False


SUPPORTED_INCAR_TO_ASE = {
    "algo",
    "ediff",
    "ediffg",
    "encut",
    "gga",
    "ibrion",
    "icharg",
    "isif",
    "ismear",
    "ispin",
    "istart",
    "ivdw",
    "ldau",
    "ldaul",
    "ldauj",
    "ldauu",
    "ldautype",
    "lwave",
    "lcharg",
    "magmom",
    "nelm",
    "nsw",
    "prec",
    "sigma",
}


REMOTE_WORKER_SCRIPT = """#!/usr/bin/env python3
from __future__ import annotations

import json
import traceback
from pathlib import Path

from ase.calculators.vasp import Vasp
from ase.io import read, write


def main() -> int:
    import sys

    if len(sys.argv) != 2:
        raise SystemExit("Usage: python remote_ase_worker.py <run_spec.json>")
    spec_path = Path(sys.argv[1]).resolve()
    spec = json.loads(spec_path.read_text(encoding="utf-8-sig"))

    workdir = Path(".").resolve()
    result_path = workdir / "result.json"
    status_path = workdir / "status.json"
    poscar_path = workdir / spec.get("poscar_filename", "POSCAR")

    status_path.write_text(json.dumps({"status": "running"}, indent=2), encoding="utf-8")
    try:
        atoms = read(poscar_path, format="vasp")
        kwargs = dict(spec.get("calculator_kwargs", {}))
        kwargs["directory"] = str(workdir)
        kwargs["txt"] = "vasp.out"
        if spec.get("launch_command"):
            kwargs["command"] = spec["launch_command"]
        calc = Vasp(**kwargs)
        atoms.calc = calc

        energy = atoms.get_potential_energy()
        forces = atoms.get_forces().tolist()

        stress = None
        try:
            stress = atoms.get_stress().tolist()
        except Exception:
            stress = None

        write(workdir / "final-structure.vasp", atoms, format="vasp", direct=True, vasp5=True)

        payload = {
            "status": "completed",
            "energy_ev": energy,
            "forces": forces,
            "stress": stress,
            "calculator_state": calc.asdict(),
        }
        result_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        status_path.write_text(json.dumps({"status": "completed"}, indent=2), encoding="utf-8")
        return 0
    except Exception as exc:
        payload = {
            "status": "failed",
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }
        result_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        status_path.write_text(json.dumps({"status": "failed"}, indent=2), encoding="utf-8")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
"""


@dataclass
class RemoteConfig:
    host: str
    username: str
    port: int = 22
    auth_method: str = "password"
    password_env: str | None = None
    ssh_key_path: str | None = None
    base_workdir: str = "/tmp/crewai-ase-runs"


@dataclass
class WorkflowConfig:
    system_tag: str
    calculation_type: str
    task_goal: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Minimal CrewAI + ASE + remote VASP pipeline: "
            "recommend params -> human confirm -> run -> parse output -> persist in external DB."
        )
    )
    parser.add_argument("--config", required=True, help="Path to JSON config file.")
    parser.add_argument("--structure", required=True, help="Path to structure file readable by ASE.")
    parser.add_argument(
        "--timeout-minutes",
        type=int,
        default=120,
        help="Remote run timeout in minutes.",
    )
    parser.add_argument(
        "--poll-seconds",
        type=int,
        default=30,
        help="Polling interval in seconds.",
    )
    return parser.parse_args()


def load_config(path: str) -> dict[str, Any]:
    config_path = Path(path)
    if not config_path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")
    return json.loads(config_path.read_text(encoding="utf-8-sig"))


def to_remote_config(config: dict[str, Any]) -> RemoteConfig:
    remote = config.get("remote", {})
    return RemoteConfig(
        host=str(remote["host"]),
        username=str(remote["username"]),
        port=int(remote.get("port", 22)),
        auth_method=str(remote.get("auth_method", "password")),
        password_env=remote.get("password_env"),
        ssh_key_path=remote.get("ssh_key_path"),
        base_workdir=str(remote.get("base_workdir", "/tmp/crewai-ase-runs")),
    )


def to_workflow_config(config: dict[str, Any]) -> WorkflowConfig:
    workflow = config.get("workflow", {})
    return WorkflowConfig(
        system_tag=str(workflow["system_tag"]),
        calculation_type=str(workflow.get("calculation_type", "relaxation")),
        task_goal=str(workflow["task_goal"]),
    )


def build_tables(metadata: MetaData) -> tuple[Table, Table]:
    validated_param_sets = Table(
        "validated_param_sets",
        metadata,
        Column("id", String(36), primary_key=True),
        Column("system_tag", String(255), nullable=False),
        Column("calculation_type", String(120), nullable=False),
        Column("incar", JSON, nullable=False),
        Column("kpts", JSON, nullable=False),
        Column("gamma", Boolean, nullable=False),
        Column("launch_command", Text, nullable=True),
        Column("source_note", Text, nullable=True),
        Column("validated_at", DateTime(timezone=True), nullable=False),
    )
    run_records = Table(
        "run_records",
        metadata,
        Column("id", String(36), primary_key=True),
        Column("system_tag", String(255), nullable=False),
        Column("calculation_type", String(120), nullable=False),
        Column("remote_host", String(255), nullable=False),
        Column("remote_workdir", Text, nullable=True),
        Column("status", String(50), nullable=False),
        Column("recommended_params", JSON, nullable=False),
        Column("confirmed_params", JSON, nullable=False),
        Column("useful_outputs", JSON, nullable=True),
        Column("error_message", Text, nullable=True),
        Column("created_at", DateTime(timezone=True), nullable=False),
        Column("updated_at", DateTime(timezone=True), nullable=False),
    )
    return validated_param_sets, run_records


def query_validated_history(
    engine,
    validated_param_sets: Table,
    *,
    system_tag: str,
    calculation_type: str,
    top_k: int = 5,
) -> list[dict[str, Any]]:
    with engine.begin() as conn:
        stmt = (
            select(validated_param_sets)
            .where(
                validated_param_sets.c.system_tag == system_tag,
                validated_param_sets.c.calculation_type == calculation_type,
            )
            .order_by(desc(validated_param_sets.c.validated_at))
            .limit(top_k)
        )
        rows = conn.execute(stmt).mappings().all()
    return [dict(row) for row in rows]


def recommend_params(
    *,
    config: dict[str, Any],
    workflow: WorkflowConfig,
    structure_summary: dict[str, Any],
    historical: list[dict[str, Any]],
) -> dict[str, Any]:
    defaults = config.get("vasp", {})
    default_payload = {
        "incar": defaults.get(
            "default_incar",
            {"ENCUT": 520, "EDIFF": 1e-5, "ISMEAR": 0, "SIGMA": 0.05, "PREC": "Accurate"},
        ),
        "kpts": defaults.get("default_kpts", [6, 6, 6]),
        "gamma": bool(defaults.get("default_gamma", True)),
        "launch_command": defaults.get("launch_command", "mpirun -np 16 vasp_std"),
        "notes": "Fallback defaults used.",
    }

    if not CREWAI_AVAILABLE:
        return default_payload

    agent_cfg = config.get("agent", {})
    if agent_cfg.get("enabled", True) is False:
        return default_payload

    history_text = json.dumps(historical, ensure_ascii=False, indent=2) if historical else "[]"
    prompt = f"""
You are a VASP parameter recommender agent.
Always use historical validated records first, then adjust for the current structure and goal.

Current workflow:
- system_tag: {workflow.system_tag}
- calculation_type: {workflow.calculation_type}
- task_goal: {workflow.task_goal}
- structure_summary: {json.dumps(structure_summary, ensure_ascii=False)}

Historical validated parameter records (external DB):
{history_text}

Output ONLY strict JSON with this schema:
{{
  "incar": {{ "ENCUT": 520, "EDIFF": 1e-5, "ISMEAR": 0, "SIGMA": 0.05, "PREC": "Accurate" }},
  "kpts": [6, 6, 6],
  "gamma": true,
  "launch_command": "mpirun -np 16 vasp_std",
  "notes": "short rationale that references historical records"
}}
"""

    llm_model = agent_cfg.get("model")
    if llm_model:
        agent = Agent(
            role="DFT Parameter Recommender",
            goal="Recommend robust VASP parameters using historical validated knowledge first.",
            backstory="You are careful and conservative; prioritize reproducibility over risky acceleration.",
            verbose=bool(agent_cfg.get("verbose", True)),
            allow_delegation=False,
            llm=llm_model,
        )
    else:
        agent = Agent(
            role="DFT Parameter Recommender",
            goal="Recommend robust VASP parameters using historical validated knowledge first.",
            backstory="You are careful and conservative; prioritize reproducibility over risky acceleration.",
            verbose=bool(agent_cfg.get("verbose", True)),
            allow_delegation=False,
        )

    task = Task(
        description=prompt,
        expected_output="Strict JSON only",
        agent=agent,
    )
    crew = Crew(
        agents=[agent],
        tasks=[task],
        process=Process.sequential,
        verbose=bool(agent_cfg.get("verbose", True)),
    )

    try:
        result = crew.kickoff()
        raw_text = getattr(result, "raw", str(result))
        parsed = parse_json_payload(raw_text)
        if parsed:
            return merge_with_defaults(default_payload, parsed)
        return default_payload
    except Exception:
        print("CrewAI recommendation failed, fallback defaults will be used.")
        print(traceback.format_exc())
        return default_payload


def parse_json_payload(text: str) -> dict[str, Any] | None:
    text = text.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    matches = re.findall(r"\{[\s\S]*\}", text)
    for candidate in matches:
        try:
            return json.loads(candidate)
        except Exception:
            continue
    return None


def merge_with_defaults(defaults: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    merged = dict(defaults)
    merged["incar"] = dict(defaults.get("incar", {}))
    merged["incar"].update(candidate.get("incar", {}))
    if isinstance(candidate.get("kpts"), list) and len(candidate["kpts"]) == 3:
        merged["kpts"] = [int(item) for item in candidate["kpts"]]
    if "gamma" in candidate:
        merged["gamma"] = bool(candidate["gamma"])
    if isinstance(candidate.get("launch_command"), str):
        merged["launch_command"] = candidate["launch_command"]
    if isinstance(candidate.get("notes"), str):
        merged["notes"] = candidate["notes"]
    return merged


def confirm_params(recommended: dict[str, Any]) -> tuple[dict[str, Any], str]:
    print("\n================ Recommended Parameters ================")
    print(json.dumps(recommended, ensure_ascii=False, indent=2))
    print("=======================================================\n")
    override = input("Paste JSON override, or press Enter to accept as-is:\n").strip()
    note = input("Optional confirmation note (why this is accepted): ").strip()

    if not override:
        return recommended, note

    parsed_override = parse_json_payload(override)
    if not parsed_override:
        raise ValueError("Override must be valid JSON.")
    confirmed = merge_with_defaults(recommended, parsed_override)
    return confirmed, note


class RemoteAseExecutor:
    def __init__(self, config: RemoteConfig) -> None:
        self.config = config
        self.client = paramiko.SSHClient()
        self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    def __enter__(self) -> "RemoteAseExecutor":
        self.connect()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        _ = exc_type, exc, tb
        self.client.close()

    def connect(self) -> None:
        kwargs: dict[str, Any] = {
            "hostname": self.config.host,
            "port": self.config.port,
            "username": self.config.username,
            "timeout": 15,
            "banner_timeout": 15,
            "auth_timeout": 15,
        }
        if self.config.auth_method == "password":
            if not self.config.password_env:
                raise ValueError("password_env must be configured for password auth.")
            password = os.getenv(self.config.password_env)
            if not password:
                raise ValueError(f"Missing environment variable for SSH password: {self.config.password_env}")
            kwargs["password"] = password
        else:
            if not self.config.ssh_key_path:
                raise ValueError("ssh_key_path must be configured for ssh_key auth.")
            kwargs["key_filename"] = self.config.ssh_key_path
        self.client.connect(**kwargs)

    def run(self, command: str) -> tuple[int, str, str]:
        stdin, stdout, stderr = self.client.exec_command(command)
        _ = stdin
        exit_code = stdout.channel.recv_exit_status()
        return (
            exit_code,
            stdout.read().decode("utf-8", errors="replace"),
            stderr.read().decode("utf-8", errors="replace"),
        )

    def upload_text(self, remote_path: str, content: str) -> None:
        with self.client.open_sftp() as sftp:
            with sftp.file(remote_path, "w") as handle:
                handle.write(content)

    def upload_file(self, local_path: str, remote_path: str) -> None:
        with self.client.open_sftp() as sftp:
            sftp.put(local_path, remote_path)

    def download_if_exists(self, remote_path: str, local_path: str) -> bool:
        with self.client.open_sftp() as sftp:
            try:
                sftp.stat(remote_path)
            except Exception:
                return False
            sftp.get(remote_path, local_path)
            return True


def build_ase_kwargs(confirmed: dict[str, Any]) -> dict[str, Any]:
    kwargs: dict[str, Any] = {}
    incar = confirmed.get("incar", {})
    for key, value in incar.items():
        low_key = str(key).lower()
        if low_key in SUPPORTED_INCAR_TO_ASE:
            kwargs[low_key] = value
    kpts = confirmed.get("kpts", [6, 6, 6])
    if isinstance(kpts, list) and len(kpts) == 3:
        kwargs["kpts"] = [int(item) for item in kpts]
    kwargs["gamma"] = bool(confirmed.get("gamma", True))
    return kwargs


def parse_useful_outputs(local_dir: Path) -> dict[str, Any]:
    outputs: dict[str, Any] = {}
    result_path = local_dir / "result.json"
    if result_path.exists():
        result_payload = json.loads(result_path.read_text(encoding="utf-8-sig"))
        outputs["status"] = result_payload.get("status")
        outputs["energy_ev"] = result_payload.get("energy_ev")
        outputs["error"] = result_payload.get("error")

        forces = result_payload.get("forces") or []
        max_force = None
        if isinstance(forces, list) and forces:
            max_force = max(
                (sum((float(component) ** 2 for component in force_vector)) ** 0.5 for force_vector in forces),
                default=None,
            )
        outputs["max_force_ev_per_ang"] = max_force

    outcar_path = local_dir / "OUTCAR"
    if outcar_path.exists():
        outcar_text = outcar_path.read_text(encoding="utf-8", errors="replace")
        outputs["outcar_converged"] = "reached required accuracy" in outcar_text.lower()

    oszicar_path = local_dir / "OSZICAR"
    if oszicar_path.exists():
        lines = [line.strip() for line in oszicar_path.read_text(encoding="utf-8", errors="replace").splitlines() if line.strip()]
        if lines:
            outputs["oszicar_last_line"] = lines[-1]
            match = re.search(r"E0=\s*([-\d.]+)", lines[-1])
            if match:
                outputs["oszicar_last_e0_ev"] = float(match.group(1))
    return outputs


def summarize_structure(structure_path: str) -> tuple[dict[str, Any], Path]:
    atoms = read(structure_path)
    summary = {
        "formula": atoms.get_chemical_formula(),
        "natoms": len(atoms),
        "pbc": list(map(bool, atoms.get_pbc())),
    }
    tmp_dir = Path(tempfile.mkdtemp(prefix="crewai-ase-"))
    poscar_path = tmp_dir / "POSCAR"
    write(poscar_path, atoms, format="vasp", direct=True, vasp5=True)
    return summary, poscar_path


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def main() -> int:
    args = parse_args()
    config = load_config(args.config)
    remote = to_remote_config(config)
    workflow = to_workflow_config(config)
    db_url = config.get("external_db", {}).get("url")
    if not db_url:
        raise ValueError("external_db.url is required in the config.")

    structure_summary, poscar_path = summarize_structure(args.structure)
    print(f"Loaded structure: {structure_summary}")

    engine = create_engine(db_url, future=True)
    metadata = MetaData()
    validated_param_sets, run_records = build_tables(metadata)
    metadata.create_all(engine)

    historical = query_validated_history(
        engine,
        validated_param_sets,
        system_tag=workflow.system_tag,
        calculation_type=workflow.calculation_type,
    )
    print(f"Historical validated records found: {len(historical)}")

    recommended = recommend_params(
        config=config,
        workflow=workflow,
        structure_summary=structure_summary,
        historical=historical,
    )
    confirmed, confirm_note = confirm_params(recommended)

    run_id = str(uuid.uuid4())
    created_at = now_utc()
    with engine.begin() as conn:
        conn.execute(
            run_records.insert().values(
                id=run_id,
                system_tag=workflow.system_tag,
                calculation_type=workflow.calculation_type,
                remote_host=remote.host,
                remote_workdir=None,
                status="created",
                recommended_params=recommended,
                confirmed_params=confirmed,
                useful_outputs=None,
                error_message=None,
                created_at=created_at,
                updated_at=created_at,
            )
        )
        conn.execute(
            validated_param_sets.insert().values(
                id=str(uuid.uuid4()),
                system_tag=workflow.system_tag,
                calculation_type=workflow.calculation_type,
                incar=confirmed.get("incar", {}),
                kpts=confirmed.get("kpts", [6, 6, 6]),
                gamma=bool(confirmed.get("gamma", True)),
                launch_command=confirmed.get("launch_command"),
                source_note=confirm_note or "human confirmed",
                validated_at=created_at,
            )
        )

    local_output_dir = Path(__file__).resolve().parent / "output" / run_id
    local_output_dir.mkdir(parents=True, exist_ok=True)
    remote_workdir = f"{remote.base_workdir.rstrip('/')}/{run_id}"
    run_spec = {
        "poscar_filename": "POSCAR",
        "launch_command": confirmed.get("launch_command"),
        "calculator_kwargs": build_ase_kwargs(confirmed),
    }

    print(f"Submitting remote ASE+VASP run on {remote.host} ...")
    try:
        with RemoteAseExecutor(remote) as executor:
            code, _, err = executor.run(f"mkdir -p {shlex.quote(remote_workdir)}")
            if code != 0:
                raise RuntimeError(f"Failed to create remote workdir: {err}")

            executor.upload_text(f"{remote_workdir}/remote_ase_worker.py", REMOTE_WORKER_SCRIPT)
            executor.upload_text(f"{remote_workdir}/run_spec.json", json.dumps(run_spec, indent=2))
            executor.upload_file(str(poscar_path), f"{remote_workdir}/POSCAR")

            submit_cmd = (
                f"cd {shlex.quote(remote_workdir)} && "
                "nohup python3 remote_ase_worker.py run_spec.json > worker.log 2>&1 & echo $!"
            )
            code, out, err = executor.run(submit_cmd)
            if code != 0:
                raise RuntimeError(f"Failed to submit remote worker: {err}")
            remote_pid = out.strip()
            print(f"Remote worker started with pid: {remote_pid}")

            with engine.begin() as conn:
                conn.execute(
                    update(run_records)
                    .where(run_records.c.id == run_id)
                    .values(
                        status="submitted",
                        remote_workdir=remote_workdir,
                        updated_at=now_utc(),
                    )
                )

            timeout_s = args.timeout_minutes * 60
            start = time.time()
            while True:
                exists_cmd = f"cd {shlex.quote(remote_workdir)} && test -f result.json && echo READY || echo RUNNING"
                _, out, _ = executor.run(exists_cmd)
                if "READY" in out:
                    break
                if time.time() - start > timeout_s:
                    raise TimeoutError("Timed out waiting for result.json from remote run.")
                time.sleep(args.poll_seconds)

            for filename in [
                "result.json",
                "status.json",
                "worker.log",
                "vasp.out",
                "OUTCAR",
                "OSZICAR",
                "CONTCAR",
                "INCAR",
                "KPOINTS",
            ]:
                executor.download_if_exists(
                    f"{remote_workdir}/{filename}",
                    str(local_output_dir / filename),
                )

    except Exception as exc:
        with engine.begin() as conn:
            conn.execute(
                update(run_records)
                .where(run_records.c.id == run_id)
                .values(status="failed", error_message=str(exc), updated_at=now_utc())
            )
        print("Run failed.")
        print(traceback.format_exc())
        return 1

    useful_outputs = parse_useful_outputs(local_output_dir)
    final_status = useful_outputs.get("status", "completed")
    with engine.begin() as conn:
        conn.execute(
            update(run_records)
            .where(run_records.c.id == run_id)
            .values(
                status=final_status,
                useful_outputs=useful_outputs,
                updated_at=now_utc(),
            )
        )

    print("\nRun completed.")
    print(json.dumps(useful_outputs, ensure_ascii=False, indent=2))
    print(f"Local outputs: {local_output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
