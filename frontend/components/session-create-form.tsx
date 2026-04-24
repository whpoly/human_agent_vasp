"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState, type FormEvent } from "react";

import { createWorkflowSession } from "@/lib/api";

const INITIAL_CONSTRAINTS = JSON.stringify(
  {
    species: ["Li", "Fe", "P", "O"],
    execution_backend_preference: "ase",
    mlip_preview_model: "MACE-medium",
    scheduler_type: "slurm",
    ntasks: 64,
    walltime: "08:00:00",
    notes: "Keep conservative convergence settings and preserve room for a later MLIP pre-relax lane."
  },
  null,
  2
);

export function SessionCreateForm() {
  const router = useRouter();
  const [title, setTitle] = useState("LiFePO4 Relaxation Studio");
  const [goal, setGoal] = useState(
    "Build a reviewable relaxation workflow with AI-assisted parameter suggestions, optional MLIP scouting, and a DFT execution handoff."
  );
  const [materialSystem, setMaterialSystem] = useState("battery cathode bulk");
  const [calculationType, setCalculationType] = useState("relaxation");
  const [structureText, setStructureText] = useState("");
  const [constraints, setConstraints] = useState(INITIAL_CONSTRAINTS);
  const [userNotes, setUserNotes] = useState(
    "Target workflow: material intake -> preprocessing -> DFT parameter review -> backend dispatch -> result/library capture."
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const formData = new FormData(event.currentTarget);
      const session = await createWorkflowSession({
        title: formData.get("title"),
        goal: formData.get("goal"),
        material_system: formData.get("materialSystem"),
        calculation_type: formData.get("calculationType"),
        structure_text: formData.get("structureText"),
        constraints: constraints.trim() ? JSON.parse(constraints) : null,
        user_notes: formData.get("userNotes")
      });
      startTransition(() => {
        router.push(`/sessions/${session.id}`);
        router.refresh();
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create workflow session.");
      setPending(false);
    }
  }

  return (
    <form className="panel form-grid" onSubmit={handleSubmit}>
      <div className="panel-header">
        <div>
          <p className="eyebrow">New studio session</p>
          <h2>Create a DFT workbench entry</h2>
        </div>
      </div>

      <label>
        Session title
        <input name="title" value={title} onChange={(event) => setTitle(event.target.value)} required />
      </label>
      <label>
        Research goal
        <textarea name="goal" rows={3} value={goal} onChange={(event) => setGoal(event.target.value)} required />
      </label>
      <label>
        Material or system type
        <input
          name="materialSystem"
          value={materialSystem}
          onChange={(event) => setMaterialSystem(event.target.value)}
        />
      </label>
      <label>
        Calculation type
        <select
          name="calculationType"
          value={calculationType}
          onChange={(event) => setCalculationType(event.target.value)}
        >
          <option value="relaxation">Relaxation</option>
          <option value="scf">SCF</option>
          <option value="static">Static</option>
          <option value="dos">DOS</option>
          <option value="band structure">Band structure</option>
          <option value="single point">Single point</option>
          <option value="surface reaction">Surface reaction</option>
        </select>
      </label>
      <label>
        Structure / POSCAR text
        <textarea
          name="structureText"
          rows={6}
          value={structureText}
          onChange={(event) => setStructureText(event.target.value)}
          placeholder="Paste POSCAR content now, or leave it blank and complete intake inside the studio page."
        />
      </label>
      <label>
        Scientist notes
        <textarea
          name="userNotes"
          rows={3}
          value={userNotes}
          onChange={(event) => setUserNotes(event.target.value)}
          placeholder="Anything the AI should preserve as a hard constraint or explicit review note."
        />
      </label>
      <label>
        Optional constraints JSON
        <textarea
          rows={8}
          value={constraints}
          onChange={(event) => setConstraints(event.target.value)}
          spellCheck={false}
        />
      </label>

      <div className="inline-actions">
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? "Creating..." : "Open studio session"}
        </button>
        {message ? <p className="inline-message error-text">{message}</p> : null}
      </div>
    </form>
  );
}
