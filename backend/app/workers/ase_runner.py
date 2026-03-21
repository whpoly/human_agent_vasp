from __future__ import annotations

import json
import traceback
from pathlib import Path

from ase.calculators.vasp import Vasp
from ase.io import read, write


def main() -> int:
    import sys

    if len(sys.argv) != 2:
        raise SystemExit("Usage: python -m app.workers.ase_runner <ase-run-spec.json>")

    spec_path = Path(sys.argv[1]).resolve()
    spec = json.loads(spec_path.read_text(encoding="utf-8-sig"))
    workdir = Path(spec["workdir"])
    workdir.mkdir(parents=True, exist_ok=True)
    status_path = workdir / "ase-status.json"
    result_path = workdir / "ase-result.json"
    poscar_path = workdir / "POSCAR"

    status_path.write_text(
        json.dumps({"status": "running", "execution_id": spec["execution_id"]}, indent=2),
        encoding="utf-8",
    )

    try:
        structure_text = spec.get("structure_text")
        if not structure_text:
            raise ValueError("No POSCAR content was provided for the ASE run.")

        poscar_path.write_text(structure_text, encoding="utf-8")
        atoms = read(poscar_path, format="vasp")

        calculator_kwargs = dict(spec.get("calculator_kwargs") or {})
        calculator_kwargs["directory"] = str(workdir)
        calculator_kwargs["txt"] = "vasp.out"
        if spec.get("launch_command"):
            calculator_kwargs["command"] = spec["launch_command"]

        calc = Vasp(**calculator_kwargs)
        atoms.calc = calc

        energy = atoms.get_potential_energy()
        forces = atoms.get_forces().tolist()

        stress = None
        try:
            stress = atoms.get_stress().tolist()
        except Exception:
            stress = None

        write(workdir / "final-structure.vasp", atoms, format="vasp", direct=True, vasp5=True)

        result = {
            "status": "completed",
            "execution_id": spec["execution_id"],
            "calculator_name": "vasp",
            "formula": atoms.get_chemical_formula(),
            "energy": energy,
            "forces": forces,
            "stress": stress,
            "warnings": spec.get("warnings", []),
            "calculator_state": calc.asdict(),
        }
        result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        status_path.write_text(json.dumps({"status": "completed"}, indent=2), encoding="utf-8")
        return 0
    except Exception as exc:
        result = {
            "status": "failed",
            "execution_id": spec.get("execution_id"),
            "calculator_name": spec.get("calculator_name", "vasp"),
            "error": str(exc),
            "traceback": traceback.format_exc(),
            "warnings": spec.get("warnings", []),
        }
        result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        status_path.write_text(json.dumps({"status": "failed"}, indent=2), encoding="utf-8")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
