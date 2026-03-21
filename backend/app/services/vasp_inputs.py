from __future__ import annotations

from textwrap import dedent

from app.models.workflow import WorkflowSession


def collect_approved_parameters(session: WorkflowSession) -> dict[str, dict]:
    payload: dict[str, dict] = {}
    for step in session.steps:
        payload[step.stage_key] = {
            parameter.name: parameter.approved_value
            for parameter in step.parameters
            if parameter.approved_value is not None
        }
    return payload


def build_vasp_input_bundle(
    session: WorkflowSession,
    *,
    scheduler_type: str,
    launch_command: str,
    scheduler_overrides: dict | None = None,
) -> dict[str, str]:
    scheduler_overrides = scheduler_overrides or {}
    approved = collect_approved_parameters(session)
    incar_params = approved.get("incar-recommendation", {})
    kpoint_params = approved.get("kpoints-configuration", {})
    submission_params = approved.get("submission-prep", {})
    potcar_params = approved.get("potcar-guidance", {})

    incar_lines = [f"{key} = {value}" for key, value in incar_params.items()]
    incar_text = "\n".join(incar_lines) if incar_lines else "# Populate approved INCAR parameters before execution."

    mesh_strategy = kpoint_params.get("mesh_strategy", "Monkhorst-Pack")
    density = str(kpoint_params.get("kpoint_density", "6x6x6")).replace("x", " ")
    kpoints_text = dedent(
        f"""\
        Automatic mesh
        0
        {mesh_strategy}
        {density}
        0 0 0
        """
    ).strip()

    poscar_text = session.structure_text or "POSCAR content must be provided by the user before execution."

    potcar_guidance = dedent(
        f"""\
        # POTCAR guidance only
        recommended_dataset = {potcar_params.get('recommended_dataset', 'PAW_PBE')}
        potcar_symbols = {potcar_params.get('potcar_symbols', 'Confirm species ordering manually')}
        """
    ).strip()

    ntasks = scheduler_overrides.get("ntasks", submission_params.get("ntasks", 32))
    walltime = scheduler_overrides.get("walltime", submission_params.get("walltime", "04:00:00"))
    queue = scheduler_overrides.get("queue", submission_params.get("queue", "interactive"))
    script_text = build_job_script(
        scheduler_type=scheduler_type,
        queue=queue,
        ntasks=ntasks,
        walltime=walltime,
        launch_command=launch_command,
    )

    return {
        "INCAR": incar_text,
        "KPOINTS": kpoints_text,
        "POSCAR": poscar_text,
        "POTCAR.guidance.txt": potcar_guidance,
        "run_job.sh": script_text,
    }


def build_job_script(
    *,
    scheduler_type: str,
    queue: str,
    ntasks: int,
    walltime: str,
    launch_command: str,
) -> str:
    if scheduler_type == "slurm":
        return dedent(
            f"""\
            #!/bin/bash
            #SBATCH -p {queue}
            #SBATCH -n {ntasks}
            #SBATCH -t {walltime}

            set -euo pipefail
            srun {launch_command}
            """
        ).strip()
    if scheduler_type == "pbs":
        return dedent(
            f"""\
            #!/bin/bash
            #PBS -q {queue}
            #PBS -l select=1:ncpus={ntasks}
            #PBS -l walltime={walltime}

            set -euo pipefail
            cd "$PBS_O_WORKDIR"
            mpirun {launch_command}
            """
        ).strip()
    return dedent(
        f"""\
        #!/bin/bash
        set -euo pipefail
        mpirun -np {ntasks} {launch_command}
        """
    ).strip()
