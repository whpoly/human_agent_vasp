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
        name="结构准备",
        description="记录初始结构、组成和计算意图。",
        parameter_hints=["system_type", "material_class", "structure_notes"],
    ),
    WorkflowStageDefinition(
        key="poscar-validation",
        name="POSCAR 验证",
        description="执行前审查晶格矢量、元素顺序和原子数量。",
        parameter_hints=["poscar_status", "symmetry_notes", "magnetic_sites"],
    ),
    WorkflowStageDefinition(
        key="incar-recommendation",
        name="INCAR 推荐",
        description="推荐计算控制参数、收敛阈值和离子弛豫标签。",
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
        name="KPOINTS 配置",
        description="推荐 k 点密度、网格类型和对称性感知设置。",
        parameter_hints=["mesh_strategy", "kpoint_density", "gamma_centered"],
    ),
    WorkflowStageDefinition(
        key="potcar-guidance",
        name="POTCAR 指引",
        description="建议 POTCAR 数据集选择，并标记需要专家确认的情况。",
        parameter_hints=["potcar_symbols", "recommended_dataset", "semicore_warning"],
    ),
    WorkflowStageDefinition(
        key="submission-prep",
        name="提交准备",
        description="打包已批准输入、调度器指令和远程执行设置。",
        parameter_hints=["queue", "nodes", "ntasks", "walltime", "launch_command"],
    ),
    WorkflowStageDefinition(
        key="result-review",
        name="结果审查",
        description="总结输出、收敛观察和验证备注。",
        parameter_hints=["convergence_status", "next_action", "validation_note"],
    ),
]


def get_stage_definition(stage_key: str) -> WorkflowStageDefinition | None:
    for stage in DEFAULT_WORKFLOW_STAGES:
        if stage.key == stage_key:
            return stage
    return None

