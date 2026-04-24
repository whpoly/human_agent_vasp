import type { WorkflowSession } from "@/lib/types";

export interface StudioModule {
  id: string;
  title: string;
  status: string;
  description: string;
  highlights: string[];
}

export interface StageBlueprint {
  title: string;
  intent: string;
  aiAction: string;
  humanAction: string;
  prompt: string;
}

export const STUDIO_MODULES: StudioModule[] = [
  {
    id: "materials",
    title: "Materials Intake",
    status: "Hybrid ready",
    description:
      "Collect POSCAR, CIF, Materials Project snippets, or manual notes with AI-assisted normalization and explicit scientist edits.",
    highlights: ["POSCAR/CIF paste and upload", "AI source summarization", "Manual provenance notes"],
  },
  {
    id: "preprocess",
    title: "AI Preflight",
    status: "Scaffolded",
    description:
      "Reserve room for symmetry checks, magnetic-site hints, oxidation guesses, and structure cleaning before DFT dispatch.",
    highlights: ["Species/count checks", "Magnetism and U hints", "Human approval gate"],
  },
  {
    id: "visuals",
    title: "Visual Lab",
    status: "Placeholder ready",
    description:
      "Provide a home for structure views, trajectory thumbnails, scalar trends, and result plots without blocking later library choices.",
    highlights: ["2D canvas placeholder", "Trajectory preview lane", "Result cards and charts"],
  },
  {
    id: "parameters",
    title: "Parameter Copilot",
    status: "API connected",
    description:
      "Keep RAG-style parameter retrieval, rationale display, editable drafts, and validated library promotion in one reviewable surface.",
    highlights: ["Recommendation workflow", "Knowledge retrieval", "Approve or validate into library"],
  },
  {
    id: "compute",
    title: "DFT Backend Bridge",
    status: "API connected",
    description:
      "Route approved jobs to ASE/VASP locally or SSH-connected clusters, keeping room for schedulers and future execution adapters.",
    highlights: ["ASE launch path", "SSH and scheduler metadata", "Execution monitoring"],
  },
  {
    id: "mlip",
    title: "MLIP Scout",
    status: "Framework ready",
    description:
      "Stage a lightweight MLIP lane for pre-relax previews and rough trajectory inspection before expensive DFT submission.",
    highlights: ["Model selector placeholder", "Trajectory trend preview", "Human compare-before-run flow"],
  },
];

export const STAGE_BLUEPRINTS: Record<string, StageBlueprint> = {
  "structure-prep": {
    title: "Structure Preparation",
    intent: "Describe the material system and capture the structure source.",
    aiAction: "Normalize intake notes and prepare the structure context.",
    humanAction: "Confirm material identity, provenance, and calculation objective.",
    prompt: "Summarize the supplied material context and propose a clean structure-preparation checklist.",
  },
  "poscar-validation": {
    title: "POSCAR Validation",
    intent: "Check species ordering, atom counts, coordinate mode, and obvious structural issues.",
    aiAction: "Flag suspicious lattice/count patterns and missing metadata.",
    humanAction: "Review the structure sanity checks and confirm or override them.",
    prompt: "Review the current POSCAR content and provide validation notes with any issues that need scientist confirmation.",
  },
  "incar-recommendation": {
    title: "INCAR Recommendation",
    intent: "Suggest conservative, well-rationalized DFT control parameters.",
    aiAction: "Generate INCAR suggestions with rationale, uncertainty, and provenance cues.",
    humanAction: "Edit and approve the final values before they are used anywhere else.",
    prompt: "Recommend INCAR parameters for this workflow and explain the scientific tradeoffs behind the key choices.",
  },
  "kpoints-configuration": {
    title: "KPOINTS Configuration",
    intent: "Estimate a reasonable mesh strategy or path setup for the selected task.",
    aiAction: "Propose mesh density and symmetry-aware defaults.",
    humanAction: "Adjust the sampling plan based on convergence risk and cost.",
    prompt: "Recommend a KPOINTS strategy with density guidance and any caveats for this material system.",
  },
  "potcar-guidance": {
    title: "POTCAR Guidance",
    intent: "Suggest pseudopotential families and highlight cases needing domain judgment.",
    aiAction: "Call out likely POTCAR choices and semicore or +U considerations.",
    humanAction: "Confirm the intended dataset and institution-specific conventions.",
    prompt: "Recommend POTCAR guidance for this system, including any cases that require expert review.",
  },
  "submission-prep": {
    title: "Submission Preparation",
    intent: "Map approved physics parameters into compute-resource decisions and launch settings.",
    aiAction: "Suggest queue, tasks, walltime, and launch style.",
    humanAction: "Verify the chosen machine, scheduler, and resource budget.",
    prompt: "Recommend submission settings for this workflow, balancing stability, cost, and turnaround time.",
  },
  "result-review": {
    title: "Result Review",
    intent: "Summarize convergence, quality signals, and next steps after execution.",
    aiAction: "Draft a review summary using the latest execution outputs.",
    humanAction: "Validate scientific adequacy and decide what should enter the knowledge library.",
    prompt: "Summarize the execution outputs, convergence state, and recommended next actions for this workflow.",
  },
};

export function getStageBlueprint(stageKey: string): StageBlueprint {
  return (
    STAGE_BLUEPRINTS[stageKey] ?? {
      title: stageKey,
      intent: "Unknown stage intent.",
      aiAction: "Generate a recommendation for the selected stage.",
      humanAction: "Review and approve the generated values.",
      prompt: "Provide a recommendation for the selected workflow stage.",
    }
  );
}

export function summarizeSessionProgress(session: WorkflowSession): {
  total: number;
  approved: number;
  validated: number;
  readyPercent: number;
} {
  const total = session.steps.length;
  const approved = session.steps.filter((step) =>
    ["approved", "completed", "validated"].includes(step.status.toLowerCase())
  ).length;
  const validated = session.steps.filter((step) => step.validated).length;
  const readyPercent = total > 0 ? Math.round((approved / total) * 100) : 0;

  return { total, approved, validated, readyPercent };
}

