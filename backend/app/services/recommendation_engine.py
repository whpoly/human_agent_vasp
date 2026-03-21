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
        step.recommendation_summary = (
            f"Recommended {len(generated)} parameters for {stage.name if stage else step.stage_name} "
            f"using workflow context and {len(similar_cases)} validated reference cases."
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

        if stage_key == "structure-prep":
            return [
                GeneratedParameter(
                    name="system_type",
                    value=session.material_system or "unspecified crystal system",
                    category="context",
                    rationale="Capturing the material family early helps the agent choose conservative VASP defaults later.",
                    source_metadata={"references": references},
                ),
                GeneratedParameter(
                    name="calculation_goal",
                    value=session.goal,
                    category="context",
                    rationale="The user goal is preserved as an explicit workflow parameter for downstream recommendation prompts and auditability.",
                    source_metadata={"references": references},
                ),
                GeneratedParameter(
                    name="calculation_type",
                    value=session.calculation_type,
                    category="context",
                    rationale="Different workflows such as relaxation, static, or DOS need different convergence and smearing choices.",
                    source_metadata={"references": references},
                ),
            ]

        if stage_key == "poscar-validation":
            return [
                GeneratedParameter(
                    name="poscar_status",
                    value="needs_human_review",
                    category="validation",
                    rationale="POSCAR parsing should remain a human-reviewed checkpoint because ordering, selective dynamics, and magnetism can be subtle.",
                    uncertainty_note="This system does not infer missing atomic positions; an expert should confirm the uploaded structure.",
                    source_metadata={"references": references},
                ),
                GeneratedParameter(
                    name="symmetry_notes",
                    value="verify symmetry reduction before dense k-point generation",
                    category="validation",
                    rationale="Unexpected symmetry breaking can change the required k-point density and relaxation path.",
                    source_metadata={"references": references},
                ),
            ]

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
                        category="sampling",
                        rationale="Mesh centering depends on dimensionality and symmetry expectations.",
                        source_metadata={"references": references},
                    ),
                    GeneratedParameter(
                        name="kpoint_density",
                        value=mesh,
                        category="sampling",
                        rationale="A stage-specific k-point density is recommended so users can audit Brillouin-zone sampling independently from INCAR settings.",
                        source_metadata={"references": references},
                    ),
                    GeneratedParameter(
                        name="gamma_centered",
                        value=True if "surface" in material or "2d" in material else False,
                        category="sampling",
                        rationale="Gamma-centered meshes are common for slabs and low-dimensional systems to avoid awkward symmetry reduction.",
                        source_metadata={"references": references},
                    ),
                ],
                request.draft_parameters,
            )

        if stage_key == "potcar-guidance":
            species = constraints.get("species") or session.material_system or "Confirm species list"
            return [
                GeneratedParameter(
                    name="potcar_symbols",
                    value=species,
                    category="pseudopotential",
                    rationale="The pseudopotential stack must match the final POSCAR species order and should remain human-confirmed.",
                    uncertainty_note="This MVP provides guidance only; it does not assemble POTCAR binaries automatically.",
                    source_metadata={"references": references},
                ),
                GeneratedParameter(
                    name="recommended_dataset",
                    value="PAW_PBE",
                    category="pseudopotential",
                    rationale="PAW_PBE is a common baseline for production VASP workflows unless the project requires another validated dataset family.",
                    source_metadata={"references": references},
                ),
            ]

        if stage_key == "submission-prep":
            scheduler_type = constraints.get("scheduler_type", "direct")
            return self._apply_draft_overrides(
                [
                    GeneratedParameter(
                        name="queue",
                        value="debug" if scheduler_type != "direct" else "interactive",
                        category="execution",
                        rationale="The MVP stores scheduler hints explicitly so users can compare agent suggestions with their actual HPC policy.",
                        source_metadata={"references": references},
                    ),
                    GeneratedParameter(
                        name="ntasks",
                        value=constraints.get("ntasks", 32),
                        category="execution",
                        rationale="A modest default parallel size keeps the generated job script usable while remaining easy to edit.",
                        source_metadata={"references": references},
                    ),
                    GeneratedParameter(
                        name="walltime",
                        value=constraints.get("walltime", "04:00:00"),
                        category="execution",
                        rationale="The walltime suggestion is conservative and should be tuned by the scientist before submission.",
                        source_metadata={"references": references},
                    ),
                    GeneratedParameter(
                        name="launch_command",
                        value=constraints.get("launch_command", "vasp_std"),
                        category="execution",
                        rationale="The launch command stays editable because site-specific VASP binaries and module environments vary significantly.",
                        source_metadata={"references": references},
                    ),
                ],
                request.draft_parameters,
            )

        if stage_key == "result-review":
            return [
                GeneratedParameter(
                    name="convergence_status",
                    value="pending_review",
                    category="review",
                    rationale="The agent should not declare convergence without explicit user confirmation from the retrieved outputs.",
                    source_metadata={"references": references},
                ),
                GeneratedParameter(
                    name="next_action",
                    value="inspect OUTCAR and OSZICAR, then mark validated if acceptable",
                    category="review",
                    rationale="The MVP emphasizes reviewable next actions rather than autonomous scientific decisions.",
                    source_metadata={"references": references},
                ),
            ]

        stage = get_stage_definition(stage_key)
        return [
            GeneratedParameter(
                name="manual_review",
                value=True,
                category="fallback",
                rationale=f"No specialized heuristics are configured for {stage.name if stage else stage_key}, so the system is defaulting to explicit human review.",
                uncertainty_note="Add a domain-specific recommender for this stage before relying on it in production.",
                source_metadata={"references": references},
            )
        ]

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
                category="accuracy",
                rationale="A 520 eV cutoff is a conservative production default for PAW datasets and reduces transferability risk across structures.",
                source_metadata={"references": references},
            ),
            GeneratedParameter(
                name="PREC",
                value="Accurate",
                category="accuracy",
                rationale="Accurate precision reduces Pulay stress and is a safe default for recommendation-driven workflows.",
                source_metadata={"references": references},
            ),
            GeneratedParameter(
                name="EDIFF",
                value=1e-6 if calc in {"static", "dos", "band structure"} else 1e-5,
                category="convergence",
                rationale="Electronic convergence is tightened for post-processing calculations to improve total energy and density of states quality.",
                source_metadata={"references": references},
            ),
            GeneratedParameter(
                name="ISMEAR",
                value=1 if is_metal else 0,
                category="electronic",
                rationale="The smearing strategy follows whether the system is metallic-like or requires a more cautious Gaussian treatment.",
                uncertainty_note=None if is_metal else "Insulating systems used for DOS or band structure may need ISMEAR=-5 after relaxation.",
                source_metadata={"references": references},
            ),
            GeneratedParameter(
                name="SIGMA",
                value=0.2 if is_metal else 0.05,
                category="electronic",
                rationale="SIGMA is paired with the smearing choice to balance stability and minimal free-energy distortion.",
                source_metadata={"references": references},
            ),
            GeneratedParameter(
                name="ALGO",
                value="Normal",
                category="electronic",
                rationale="ALGO=Normal is usually the safest production choice unless there is a documented need for a faster or more robust solver.",
                source_metadata={"references": references},
            ),
            GeneratedParameter(
                name="ISPIN",
                value=2 if is_magnetic else 1,
                category="magnetism",
                rationale="Spin polarization is enabled when the material description hints at transition-metal or magnetic behavior.",
                uncertainty_note="Initial magnetic moments are not inferred in this MVP; review MAGMOM manually for open-shell systems."
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
                        category="ionic",
                        rationale="Conjugate-gradient ionic updates are a stable first choice for routine structural relaxations.",
                        source_metadata={"references": references},
                    ),
                    GeneratedParameter(
                        name="NSW",
                        value=120,
                        category="ionic",
                        rationale="A moderate ionic step budget prevents premature termination on larger cells while staying reviewable.",
                        source_metadata={"references": references},
                    ),
                    GeneratedParameter(
                        name="ISIF",
                        value=3,
                        category="ionic",
                        rationale="ISIF=3 permits simultaneous ionic and cell relaxation for a general geometry optimization.",
                        uncertainty_note="If the lattice should remain fixed, change ISIF before approval.",
                        source_metadata={"references": references},
                    ),
                    GeneratedParameter(
                        name="EDIFFG",
                        value=-0.02,
                        category="ionic",
                        rationale="A force-based stopping criterion of -0.02 eV/Ang is a pragmatic production default for relaxation workflows.",
                        source_metadata={"references": references},
                    ),
                ]
            )
        if ldau_needed:
            base_params.append(
                GeneratedParameter(
                    name="LDAU",
                    value={"enabled": True, "review_required": True},
                    category="correlation",
                    rationale="Transition-metal and oxide systems often require DFT+U review, but the exact U values must remain explicitly human-approved.",
                    uncertainty_note="Confirm oxidation states and U/J references before enabling DFT+U in production.",
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
                parameter.rationale += " The current draft override was preserved to support iterative refinement."
        return parameters
