from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class WorkflowStageDefinition:
    key: str
    name: str
    description: str
    parameter_hints: list[str] = field(default_factory=list)


DEFAULT_WORKFLOW_STAGES: list[WorkflowStageDefinition] = [
    WorkflowStageDefinition(
        key="structure-prep",
        name="Structure Preparation",
        description="Capture the initial structure, composition, and calculation intent.",
        parameter_hints=["system_type", "material_class", "structure_notes"],
    ),
    WorkflowStageDefinition(
        key="poscar-validation",
        name="POSCAR Validation",
        description="Review lattice vectors, species ordering, and atom counts before execution.",
        parameter_hints=["poscar_status", "symmetry_notes", "magnetic_sites"],
    ),
    WorkflowStageDefinition(
        key="incar-recommendation",
        name="INCAR Recommendation",
        description="Recommend calculation controls, convergence thresholds, and ionic relaxation tags.",
        parameter_hints=[
            "ENCUT",
            "EDIFF",
            "EDIFFG",
            "IBRION",
            "NSW",
            "ISIF",
            "PREC",
            "ALGO",
            "ISMEAR",
            "SIGMA",
            "ISPIN",
            "LDAU",
        ],
    ),
    WorkflowStageDefinition(
        key="kpoints-configuration",
        name="KPOINTS Configuration",
        description="Recommend k-point density, mesh style, and symmetry-aware settings.",
        parameter_hints=["mesh_strategy", "kpoint_density", "gamma_centered"],
    ),
    WorkflowStageDefinition(
        key="potcar-guidance",
        name="POTCAR Guidance",
        description="Suggest POTCAR family choices and flag cases needing expert confirmation.",
        parameter_hints=["potcar_symbols", "recommended_dataset", "semicore_warning"],
    ),
    WorkflowStageDefinition(
        key="submission-prep",
        name="Submission Preparation",
        description="Package approved inputs, scheduler instructions, and remote execution settings.",
        parameter_hints=["queue", "nodes", "ntasks", "walltime", "launch_command"],
    ),
    WorkflowStageDefinition(
        key="result-review",
        name="Result Review",
        description="Summarize outputs, convergence observations, and validation notes.",
        parameter_hints=["convergence_status", "next_action", "validation_note"],
    ),
]


def get_stage_definition(stage_key: str) -> WorkflowStageDefinition | None:
    for stage in DEFAULT_WORKFLOW_STAGES:
        if stage.key == stage_key:
            return stage
    return None

