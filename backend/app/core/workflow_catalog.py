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
        key="materials-prep",
        name="材料准备",
        description="导入结构、检查 POSCAR/CIF，并记录材料来源和计算意图。",
        parameter_hints=["system_type", "calculation_goal", "calculation_type", "poscar_status", "symmetry_notes"],
    ),
    WorkflowStageDefinition(
        key="parameter-confirmation",
        name="参数确认",
        description="结合本地 RAG 和内置规则推荐 INCAR、KPOINTS 与 POTCAR，并等待人工确认。",
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
            "mesh_strategy",
            "kpoint_density",
            "gamma_centered",
            "potcar_symbols",
            "recommended_dataset",
        ],
    ),
    WorkflowStageDefinition(
        key="calculation-submit",
        name="计算提交",
        description="打包已批准输入、调度器指令和远程执行设置。",
        parameter_hints=["queue", "nodes", "ntasks", "walltime", "launch_command"],
    ),
    WorkflowStageDefinition(
        key="result-archive",
        name="结果归档",
        description="总结输出、收敛观察、验证备注和知识库归档决策。",
        parameter_hints=["convergence_status", "next_action", "validation_note"],
    ),
]


def get_stage_definition(stage_key: str) -> WorkflowStageDefinition | None:
    for stage in DEFAULT_WORKFLOW_STAGES:
        if stage.key == stage_key:
            return stage
    return None

