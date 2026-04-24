from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.models.workflow import WorkflowSession
from app.services.vasp_inputs import NON_INCAR_PARAMETER_KEYS, collect_approved_parameters


SUPPORTED_ASE_VASP_TAGS = {
    "addgrid",
    "algo",
    "ediff",
    "ediffg",
    "encut",
    "gga",
    "ibrion",
    "icharg",
    "idipol",
    "images",
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
    "lmaxmix",
    "lorbit",
    "lreal",
    "lwave",
    "lcharg",
    "magmom",
    "nelm",
    "nsw",
    "prec",
    "sigma",
    "system",
}


def build_ase_vasp_run_spec(
    session: WorkflowSession,
    *,
    execution_id: str,
    workdir: str,
    launch_command: str | None,
) -> dict[str, Any]:
    approved = collect_approved_parameters(session)
    calculator_kwargs, warnings = build_ase_vasp_kwargs(approved)
    submission_params = approved.get("calculation-submit") or approved.get("submission-prep", {})
    launch = launch_command or submission_params.get("launch_command") or get_settings().ase_vasp_command

    if not launch:
        warnings.append(
            "No ASE VASP command was supplied. Set launch_command in calculation-submit or ASE_VASP_COMMAND in the environment."
        )

    return {
        "execution_id": execution_id,
        "calculator_name": "vasp",
        "workdir": workdir,
        "launch_command": launch,
        "structure_text": session.structure_text,
        "calculator_kwargs": calculator_kwargs,
        "warnings": warnings,
        "approved_parameters": approved,
        "session_summary": {
            "session_id": session.id,
            "title": session.title,
            "goal": session.goal,
            "material_system": session.material_system,
            "calculation_type": session.calculation_type,
        },
    }


def build_ase_vasp_kwargs(approved_parameters: dict[str, dict]) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    calculator_kwargs: dict[str, Any] = {}

    parameter_params = approved_parameters.get("parameter-confirmation", {})
    incar_params = approved_parameters.get("incar-recommendation") or {
        key: value for key, value in parameter_params.items() if key not in NON_INCAR_PARAMETER_KEYS
    }
    for key, value in incar_params.items():
        normalized_key = str(key).lower()
        if normalized_key == "ldau":
            _merge_ldau_kwargs(calculator_kwargs, value, warnings)
            continue
        if normalized_key in SUPPORTED_ASE_VASP_TAGS and _is_serializable_for_ase(value):
            calculator_kwargs[normalized_key] = value
        else:
            warnings.append(f"Skipped INCAR tag {key} because it is not currently mapped into the ASE VASP adapter.")

    kpoints_params = approved_parameters.get("kpoints-configuration") or parameter_params
    kpts = _parse_kpoints_mesh(kpoints_params.get("kpoint_density"))
    if kpts:
        calculator_kwargs["kpts"] = kpts
    else:
        calculator_kwargs["kpts"] = (6, 6, 6)
        warnings.append("KPOINTS stage not approved; fallback mesh (6,6,6) was used.")
    if bool(kpoints_params.get("gamma_centered")):
        calculator_kwargs["gamma"] = True
    else:
        calculator_kwargs.setdefault("gamma", True)

    potcar_params = approved_parameters.get("potcar-guidance") or parameter_params
    dataset = str(potcar_params.get("recommended_dataset", "")).upper()
    if dataset == "PAW_PBE":
        calculator_kwargs.setdefault("xc", "PBE")
    elif dataset == "PAW_LDA":
        calculator_kwargs.setdefault("xc", "LDA")

    return calculator_kwargs, warnings


def write_run_spec(spec: dict[str, Any], spec_path: Path) -> None:
    spec_path.parent.mkdir(parents=True, exist_ok=True)
    spec_path.write_text(json.dumps(spec, indent=2), encoding="utf-8")


def read_run_result(result_path: Path) -> dict[str, Any] | None:
    if not result_path.exists():
        return None
    return json.loads(result_path.read_text(encoding="utf-8-sig"))


def _merge_ldau_kwargs(target: dict[str, Any], value: Any, warnings: list[str]) -> None:
    if isinstance(value, bool):
        target["ldau"] = value
        return
    if not isinstance(value, dict):
        warnings.append("Skipped LDAU because the approved value was not a boolean or detailed mapping.")
        return

    detailed_keys = {"ldau", "ldautype", "ldaul", "ldauu", "ldauj"}
    if detailed_keys.intersection({str(key).lower() for key in value}):
        for key, nested_value in value.items():
            normalized_key = str(key).lower()
            if normalized_key in detailed_keys:
                target[normalized_key] = nested_value
        target.setdefault("ldau", True)
        return

    if value.get("enabled") is True:
        warnings.append(
            "LDAU was marked as enabled, but no detailed ldauu/ldaul/ldauj settings were provided. The tag was not forwarded to ASE."
        )


def _parse_kpoints_mesh(value: Any) -> tuple[int, int, int] | None:
    if isinstance(value, (list, tuple)) and len(value) == 3:
        return tuple(int(item) for item in value)
    if isinstance(value, str):
        parts = value.lower().replace(" ", "").split("x")
        if len(parts) == 3 and all(part.isdigit() for part in parts):
            return tuple(int(part) for part in parts)
    return None


def _is_serializable_for_ase(value: Any) -> bool:
    return isinstance(value, (str, int, float, bool, list, tuple, dict)) or value is None
