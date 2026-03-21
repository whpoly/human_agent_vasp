"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState, type FormEvent } from "react";

import { createWorkflowSession } from "@/lib/api";

const INITIAL_CONSTRAINTS = JSON.stringify(
  {
    species: ["Fe", "O"],
    scheduler_type: "slurm",
    ntasks: 64,
    walltime: "08:00:00"
  },
  null,
  2
);

export function SessionCreateForm() {
  const router = useRouter();
  const [title, setTitle] = useState("Fe2O3 SCF run");
  const [goal, setGoal] = useState(
    "Run an SCF calculation and capture key output information for traceable reuse."
  );
  const [materialSystem, setMaterialSystem] = useState("transition-metal oxide bulk");
  const [calculationType, setCalculationType] = useState("scf");
  const [structureText, setStructureText] = useState("");
  const [constraints, setConstraints] = useState(INITIAL_CONSTRAINTS);
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
        constraints: constraints.trim() ? JSON.parse(constraints) : null
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
          <p className="eyebrow">New workflow</p>
          <h2>Create a review-first VASP session</h2>
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
          <option value="scf">SCF</option>
          <option value="relaxation">Relaxation</option>
          <option value="static">Static</option>
          <option value="dos">DOS</option>
          <option value="band structure">Band structure</option>
          <option value="single point">Single point</option>
        </select>
      </label>
      <label>
        Structure / POSCAR text
        <textarea
          name="structureText"
          rows={6}
          value={structureText}
          onChange={(event) => setStructureText(event.target.value)}
          placeholder="Paste POSCAR content or leave blank for later review."
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
          {pending ? "Creating..." : "Create workflow"}
        </button>
        {message ? <p className="inline-message error-text">{message}</p> : null}
      </div>
    </form>
  );
}
