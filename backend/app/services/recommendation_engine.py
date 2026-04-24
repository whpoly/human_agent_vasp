from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.workflow_catalog import DEFAULT_WORKFLOW_STAGES, get_stage_definition
from app.models.workflow import StepParameter, StepRevision, WorkflowSession, WorkflowStep
from app.schemas.workflow import RecommendationRequest
from app.services.audit import log_event
from app.services.knowledge_base import KnowledgeBaseService


@dataclass
class GeneratedParameter:
    name: str
    value: Any
    category: str
    rationale: str
    uncertainty_note: str | None = None
    source_metadata: dict | None = None


class RecommendationEngine:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.knowledge = KnowledgeBaseService(db)

    def ensure_workflow_steps(self, session: WorkflowSession) -> list[WorkflowStep]:
        if session.steps:
            return sorted(session.steps, key=lambda item: item.stage_index)

        created_steps: list[WorkflowStep] = []
        for index, stage in enumerate(DEFAULT_WORKFLOW_STAGES):
            step = WorkflowStep(
                session_id=session.id,
                stage_key=stage.key,
                stage_name=stage.name,
                stage_index=index,
                status="pending",
                context_snapshot={},
            )
            self.db.add(step)
            created_steps.append(step)

        self.db.flush()
        log_event(
            self.db,
            entity_type="workflow_session",
            entity_id=session.id,
            action="steps_initialized",
            actor_type="system",
            details={"count": len(created_steps)},
        )
        return created_steps

    def generate_recommendations(
        self,
        session: WorkflowSession,
        request: RecommendationRequest,
    ) -> WorkflowStep:
        self.ensure_workflow_steps(session)
        step = self.db.scalar(
            select(WorkflowStep).where(
                WorkflowStep.session_id == session.id,
                WorkflowStep.stage_key == request.stage_key,
            )
        )
        if not step:
            raise ValueError(f"Unknown stage: {request.stage_key}")

        similar_cases = self.knowledge.retrieve_similar_cases(
            stage_key=request.stage_key,
            calculation_type=session.calculation_type,
            material_system=session.material_system,
            task_goal=request.user_intent or session.goal,
            top_k=5,
        )

        generated = self._build_stage_recommendations(
            session=session,
            request=request,
            similar_cases=similar_cases,
        )

        step.parameters.clear()
        for parameter in generated:
            step.parameters.append(
                StepParameter(
                    name=parameter.name,
                    category=parameter.category,
                    suggested_value=parameter.value,
                    rationale=parameter.rationale,
                    uncertainty_note=parameter.uncertainty_note,
                    source_metadata=parameter.source_metadata,
                )
            )

        stage = get_stage_definition(step.stage_key)
        step.status = "recommended"
        rag_summary = (
            f"命中本地 RAG 已验证案例 {len(similar_cases)} 个。"
            if similar_cases
            else "本地 RAG 暂无已验证案例，本次建议来自会话上下文和内置启发式规则。"
        )
        step.recommendation_summary = (
            f"已为{stage.name if stage else step.stage_name}推荐 {len(generated)} 个参数。{rag_summary}"
        )
        step.warnings = [item.uncertainty_note for item in generated if item.uncertainty_note]
        step.context_snapshot = self._build_context_snapshot(session, request, similar_cases)
        self._create_revision(
            step=step,
            actor_type="agent",
            action="recommendation_generated",
            payload={
                "request": request.model_dump(),
                "parameters": {item.name: item.value for item in generated},
                "similar_case_ids": [entry.id for entry in similar_cases],
            },
            note=request.user_feedback,
        )
        session.current_stage_key = step.stage_key
        log_event(
            self.db,
            entity_type="workflow_step",
            entity_id=step.id,
            action="recommendation_generated",
            actor_type="agent",
            details={
                "stage_key": step.stage_key,
                "parameter_count": len(generated),
                "similar_case_ids": [entry.id for entry in similar_cases],
            },
        )
        self.db.flush()
        return step

    def approve_step(
        self,
        step: WorkflowStep,
        *,
        parameters: list[dict],
        note: str | None,
        mark_validated: bool,
    ) -> WorkflowStep:
        parameter_map = {parameter.name: parameter for parameter in step.parameters}
        approved_payload: dict[str, Any] = {}
        for item in parameters:
            if item["name"] not in parameter_map:
                continue
            parameter = parameter_map[item["name"]]
            parameter.edited_value = item.get("edited_value")
            parameter.approved_value = item.get("approved_value")
            if item.get("rationale"):
                parameter.rationale = item["rationale"]
            if item.get("uncertainty_note") is not None:
                parameter.uncertainty_note = item["uncertainty_note"]
            approved_payload[item["name"]] = {
                "suggested_value": parameter.suggested_value,
                "edited_value": parameter.edited_value,
                "approved_value": parameter.approved_value,
            }

        from datetime import datetime, timezone

        step.status = "validated" if mark_validated else "approved"
        step.validated = mark_validated
        step.approved_at = datetime.now(timezone.utc)
        self._create_revision(
            step=step,
            actor_type="human",
            action="step_approved",
            payload=approved_payload,
            note=note,
        )
        log_event(
            self.db,
            entity_type="workflow_step",
            entity_id=step.id,
            action="step_approved",
            actor_type="human",
            details={
                "mark_validated": mark_validated,
                "parameter_count": len(approved_payload),
            },
        )
        self.db.flush()
        return step

    def _create_revision(
        self,
        *,
        step: WorkflowStep,
        actor_type: str,
        action: str,
        payload: dict,
        note: str | None,
    ) -> None:
        from datetime import datetime, timezone

        current_version = len(step.revisions) + 1
        step.revisions.append(
            StepRevision(
                version_number=current_version,
                actor_type=actor_type,
                action=action,
                payload=payload,
                note=note,
                created_at=datetime.now(timezone.utc),
            )
        )

    def _build_context_snapshot(
        self,
        session: WorkflowSession,
        request: RecommendationRequest,
        similar_cases: list,
    ) -> dict:
        approved_steps = []
        for step in session.steps:
            if step.status not in {"approved", "validated", "executed"}:
                continue
            approved_steps.append(
                {
                    "stage_key": step.stage_key,
                    "parameters": {
                        parameter.name: parameter.approved_value
                        for parameter in step.parameters
                        if parameter.approved_value is not None
                    },
                }
            )

        return {
            "session_goal": session.goal,
            "material_system": session.material_system,
            "calculation_type": session.calculation_type,
            "constraints": request.constraints or session.constraints or {},
            "approved_steps": approved_steps,
            "draft_parameters": request.draft_parameters or {},
            "user_feedback": request.user_feedback,
            "similar_cases": [
                {
                    "id": entry.id,
                    "trust_score": entry.trust_score,
                    "validation_note": entry.validation_note,
                }
                for entry in similar_cases
            ],
        }

    def _build_stage_recommendations(
        self,
        *,
        session: WorkflowSession,
        request: RecommendationRequest,
        similar_cases: list,
    ) -> list[GeneratedParameter]:
        stage_key = request.stage_key
        calc = session.calculation_type.lower()
        if calc == "scf":
            calc = "static"
        material = (session.material_system or "").lower()
        constraints = request.constraints or session.constraints or {}
        references = [{"entry_id": entry.id, "trust_score": entry.trust_score} for entry in similar_cases]

        if stage_key in {"materials-prep", "structure-prep"}:
            return [
                GeneratedParameter(
                    name="system_type",
                    value=session.material_system or "未指定晶体体系",
                    category="上下文",
                    rationale="尽早记录材料族有助于智能体在后续选择更保守的 VASP 默认值。",
                    source_metadata={"references": references},
                ),
                GeneratedParameter(
                    name="calculation_goal",
                    value=session.goal,
                    category="上下文",
                    rationale="用户目标会作为显式工作流参数保留，便于后续推荐提示和审计追踪。",
                    source_metadata={"references": references},
                ),
                GeneratedParameter(
                    name="calculation_type",
                    value=session.calculation_type,
                    category="上下文",
                    rationale="弛豫、静态计算或 DOS 等不同工作流需要不同的收敛与展宽选择。",
                    source_metadata={"references": references},
                ),
                GeneratedParameter(
                    name="poscar_status",
                    value="需要人工审查",
                    category="验证",
                    rationale="POSCAR/CIF 导入后仍需人工确认元素顺序、数量行、坐标模式和选择性动力学标记。",
                    uncertainty_note="当前系统不会推断缺失的原子位置；专家应确认上传结构。",
                    source_metadata={"references": references},
                ),
                GeneratedParameter(
                    name="symmetry_notes",
                    value="生成参数前先确认对称性和维度假设",
                    category="验证",
                    rationale="意外的对称性破缺或 slab/体相误判会影响 k 点密度、弛豫策略和赝势选择。",
                    source_metadata={"references": references},
                ),
            ]

        if stage_key == "poscar-validation":
            return [
                GeneratedParameter(
                    name="poscar_status",
                    value="需要人工审查",
                    category="验证",
                    rationale="POSCAR 解析应保留人工审查关口，因为元素顺序、选择性动力学和磁性设置都可能很微妙。",
                    uncertainty_note="当前系统不会推断缺失的原子位置；专家应确认上传结构。",
                    source_metadata={"references": references},
                ),
                GeneratedParameter(
                    name="symmetry_notes",
                    value="生成密集 k 点前先确认对称性约化",
                    category="验证",
                    rationale="意外的对称性破缺可能改变所需 k 点密度和弛豫路径。",
                    source_metadata={"references": references},
                ),
            ]

        if stage_key == "parameter-confirmation":
            return self._build_parameter_confirmation_recommendations(
                calc=calc,
                material=material,
                constraints=constraints,
                request=request,
                references=references,
            )

        if stage_key == "incar-recommendation":
            return self._build_incar_recommendations(
                calc=calc,
                material=material,
                constraints=constraints,
                request=request,
                references=references,
            )

        if stage_key == "kpoints-configuration":
            mesh = constraints.get("kpoint_density") or ("9x9x9" if "bulk" in material else "5x5x1")
            return self._apply_draft_overrides(
                [
                    GeneratedParameter(
                        name="mesh_strategy",
                        value="gamma-centered" if "surface" in material or "2d" in material else "Monkhorst-Pack",
                        category="采样",
                        rationale="网格中心选择取决于维度和预期对称性。",
                        source_metadata={"references": references},
                    ),
                    GeneratedParameter(
                        name="kpoint_density",
                        value=mesh,
                        category="采样",
                        rationale="建议为该阶段单独记录 k 点密度，便于用户独立审查布里渊区采样，而不与 INCAR 设置混在一起。",
                        source_metadata={"references": references},
                    ),
                    GeneratedParameter(
                        name="gamma_centered",
                        value=True if "surface" in material or "2d" in material else False,
                        category="采样",
                        rationale="对于 slab 和低维体系，Gamma 中心网格常用于避免不合适的对称性约化。",
                        source_metadata={"references": references},
                    ),
                ],
                request.draft_parameters,
            )

        if stage_key == "potcar-guidance":
            species = constraints.get("species") or session.material_system or "请确认元素列表"
            return [
                GeneratedParameter(
                    name="potcar_symbols",
                    value=species,
                    category="赝势",
                    rationale="赝势顺序必须匹配最终 POSCAR 的元素顺序，并应保留人工确认。",
                    uncertainty_note="当前 MVP 仅提供指引，不会自动组装 POTCAR 二进制文件。",
                    source_metadata={"references": references},
                ),
                GeneratedParameter(
                    name="recommended_dataset",
                    value="PAW_PBE",
                    category="赝势",
                    rationale="除非项目要求使用其他已验证数据集族，PAW_PBE 通常是生产级 VASP 工作流的常用基线。",
                    source_metadata={"references": references},
                ),
            ]

        if stage_key in {"calculation-submit", "submission-prep"}:
            scheduler_type = constraints.get("scheduler_type", "direct")
            return self._apply_draft_overrides(
                [
                    GeneratedParameter(
                        name="queue",
                        value="debug" if scheduler_type != "direct" else "interactive",
                        category="执行",
                        rationale="MVP 会显式保存调度器提示，便于用户将智能体建议与实际 HPC 策略对比。",
                        source_metadata={"references": references},
                    ),
                    GeneratedParameter(
                        name="ntasks",
                        value=constraints.get("ntasks", 32),
                        category="执行",
                        rationale="适中的默认并行规模可让生成的作业脚本可用，同时保持易于编辑。",
                        source_metadata={"references": references},
                    ),
                    GeneratedParameter(
                        name="walltime",
                        value=constraints.get("walltime", "04:00:00"),
                        category="执行",
                        rationale="墙时建议偏保守，提交前应由科研人员根据体系和机器情况调整。",
                        source_metadata={"references": references},
                    ),
                    GeneratedParameter(
                        name="launch_command",
                        value=constraints.get("launch_command", "vasp_std"),
                        category="执行",
                        rationale="启动命令保持可编辑，因为不同站点的 VASP 二进制和模块环境差异很大。",
                        source_metadata={"references": references},
                    ),
                ],
                request.draft_parameters,
            )

        if stage_key in {"result-archive", "result-review"}:
            return [
                GeneratedParameter(
                    name="convergence_status",
                    value="等待审查",
                    category="审查",
                    rationale="在用户基于输出显式确认前，智能体不应自行宣称已收敛。",
                    source_metadata={"references": references},
                ),
                GeneratedParameter(
                    name="next_action",
                    value="检查 OUTCAR 和 OSZICAR；若可接受，再标记为已验证",
                    category="审查",
                    rationale="MVP 强调可审查的下一步行动，而不是自主做出科学结论。",
                    source_metadata={"references": references},
                ),
            ]

        stage = get_stage_definition(stage_key)
        return [
            GeneratedParameter(
                name="manual_review",
                value=True,
                category="兜底",
                rationale=f"尚未为{stage.name if stage else stage_key}配置专用启发式规则，因此系统默认进入显式人工审查。",
                uncertainty_note="在生产环境依赖该阶段前，应补充领域专用推荐器。",
                source_metadata={"references": references},
            )
        ]

    def _build_parameter_confirmation_recommendations(
        self,
        *,
        calc: str,
        material: str,
        constraints: dict,
        request: RecommendationRequest,
        references: list[dict],
    ) -> list[GeneratedParameter]:
        base_params = self._build_incar_recommendations(
            calc=calc,
            material=material,
            constraints=constraints,
            request=request,
            references=references,
        )
        mesh = constraints.get("kpoint_density") or ("9x9x9" if "bulk" in material else "5x5x1")
        species = constraints.get("species") or "请从最终 POSCAR 元素行确认"
        rag_note = None if references else "本地 RAG 当前没有可复用计算案例；该建议需要人工重点审查。"
        base_params.extend(
            [
                GeneratedParameter(
                    name="mesh_strategy",
                    value="gamma-centered" if "surface" in material or "2d" in material else "Monkhorst-Pack",
                    category="采样",
                    rationale="网格中心选择取决于维度、对称性和后续能带/DOS 目标。",
                    uncertainty_note=rag_note,
                    source_metadata={"references": references, "rag_store": "local-db"},
                ),
                GeneratedParameter(
                    name="kpoint_density",
                    value=mesh,
                    category="采样",
                    rationale="将 k 点密度与 INCAR 分开记录，便于用户独立审查布里渊区采样和计算成本。",
                    uncertainty_note=rag_note,
                    source_metadata={"references": references, "rag_store": "local-db"},
                ),
                GeneratedParameter(
                    name="gamma_centered",
                    value=True if "surface" in material or "2d" in material else False,
                    category="采样",
                    rationale="对于 slab 和低维体系，Gamma 中心网格常用于避免不合适的对称性约化。",
                    source_metadata={"references": references, "rag_store": "local-db"},
                ),
                GeneratedParameter(
                    name="potcar_symbols",
                    value=species,
                    category="赝势",
                    rationale="POTCAR 顺序必须匹配最终 POSCAR 元素顺序；如果约束中没有元素列表，则保留人工确认。",
                    uncertainty_note="当前 MVP 只保存赝势指引，不自动组装 POTCAR 二进制文件。",
                    source_metadata={"references": references, "rag_store": "local-db"},
                ),
                GeneratedParameter(
                    name="recommended_dataset",
                    value="PAW_PBE",
                    category="赝势",
                    rationale="除非项目要求使用其他已验证数据集族，PAW_PBE 是生产级 VASP 工作流的常用基线。",
                    source_metadata={"references": references, "rag_store": "local-db"},
                ),
            ]
        )
        return self._apply_draft_overrides(base_params, request.draft_parameters)

    def _build_incar_recommendations(
        self,
        *,
        calc: str,
        material: str,
        constraints: dict,
        request: RecommendationRequest,
        references: list[dict],
    ) -> list[GeneratedParameter]:
        is_metal = "metal" in material or calc in {"dos", "band structure", "static"}
        is_relax = calc == "relaxation"
        ldau_needed = any(token in material for token in ["fe", "co", "ni", "mn", "rare earth", "oxide"])
        is_magnetic = any(token in material for token in ["fe", "co", "ni", "mn", "magnetic"])
        base_params = [
            GeneratedParameter(
                name="ENCUT",
                value=max(520, int(constraints.get("minimum_encut", 520))),
                category="精度",
                rationale="520 eV 截断能是 PAW 数据集的保守生产默认值，可降低跨结构迁移风险。",
                source_metadata={"references": references},
            ),
            GeneratedParameter(
                name="PREC",
                value="Accurate",
                category="精度",
                rationale="PREC=Accurate 可降低 Pulay 应力，是推荐驱动工作流中的稳妥默认值。",
                source_metadata={"references": references},
            ),
            GeneratedParameter(
                name="EDIFF",
                value=1e-6 if calc in {"static", "dos", "band structure"} else 1e-5,
                category="收敛",
                rationale="后处理计算会收紧电子收敛，以提升总能和态密度质量。",
                source_metadata={"references": references},
            ),
            GeneratedParameter(
                name="ISMEAR",
                value=1 if is_metal else 0,
                category="电子",
                rationale="展宽策略取决于体系是否表现为金属性，或是否需要更谨慎的高斯处理。",
                uncertainty_note=None if is_metal else "用于 DOS 或能带的绝缘体系在弛豫后可能需要 ISMEAR=-5。",
                source_metadata={"references": references},
            ),
            GeneratedParameter(
                name="SIGMA",
                value=0.2 if is_metal else 0.05,
                category="电子",
                rationale="SIGMA 与展宽方式配套，用于平衡稳定性和较小的自由能扰动。",
                source_metadata={"references": references},
            ),
            GeneratedParameter(
                name="ALGO",
                value="Normal",
                category="电子",
                rationale="除非已有文档说明需要更快或更稳健的求解器，ALGO=Normal 通常是最稳妥的生产选择。",
                source_metadata={"references": references},
            ),
            GeneratedParameter(
                name="ISPIN",
                value=2 if is_magnetic else 1,
                category="磁性",
                rationale="当材料描述暗示过渡金属或磁性行为时，启用自旋极化。",
                uncertainty_note="当前 MVP 不推断初始磁矩；开壳层体系请手动审查 MAGMOM。"
                if is_magnetic
                else None,
                source_metadata={"references": references},
            ),
        ]
        if is_relax:
            base_params.extend(
                [
                    GeneratedParameter(
                        name="IBRION",
                        value=2,
                        category="离子",
                        rationale="共轭梯度离子更新是常规结构弛豫的稳定首选。",
                        source_metadata={"references": references},
                    ),
                    GeneratedParameter(
                        name="NSW",
                        value=120,
                        category="离子",
                        rationale="适中的离子步数预算可避免较大晶胞过早终止，同时保持结果可审查。",
                        source_metadata={"references": references},
                    ),
                    GeneratedParameter(
                        name="ISIF",
                        value=3,
                        category="离子",
                        rationale="ISIF=3 允许离子和晶胞同时弛豫，适合一般几何优化。",
                        uncertainty_note="如果晶格应保持固定，请在批准前修改 ISIF。",
                        source_metadata={"references": references},
                    ),
                    GeneratedParameter(
                        name="EDIFFG",
                        value=-0.02,
                        category="离子",
                        rationale="-0.02 eV/Ang 的力收敛停止准则是弛豫工作流中务实的生产默认值。",
                        source_metadata={"references": references},
                    ),
                ]
            )
        if ldau_needed:
            base_params.append(
                GeneratedParameter(
                    name="LDAU",
                    value={"enabled": True, "review_required": True},
                    category="关联",
                    rationale="过渡金属和氧化物体系通常需要 DFT+U 审查，但具体 U 值必须由人工明确批准。",
                    uncertainty_note="在生产环境启用 DFT+U 前，请确认氧化态和 U/J 参考来源。",
                    source_metadata={"references": references},
                )
            )
        return self._apply_draft_overrides(base_params, request.draft_parameters)

    def _apply_draft_overrides(
        self,
        parameters: list[GeneratedParameter],
        draft_parameters: dict[str, Any] | None,
    ) -> list[GeneratedParameter]:
        if not draft_parameters:
            return parameters
        for parameter in parameters:
            if parameter.name in draft_parameters:
                parameter.value = draft_parameters[parameter.name]
                parameter.rationale += " 已保留当前草稿覆盖值，以支持迭代优化。"
        return parameters
