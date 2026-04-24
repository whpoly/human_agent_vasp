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
    notes: "保持保守收敛设置，并为后续 MLIP 预弛豫通道预留空间。"
  },
  null,
  2
);

export function SessionCreateForm() {
  const router = useRouter();
  const [title, setTitle] = useState("LiFePO4 弛豫工作室");
  const [goal, setGoal] = useState(
    "构建一个可审查的弛豫工作流，包含 AI 辅助参数建议、可选 MLIP 预探以及 DFT 执行交接。"
  );
  const [materialSystem, setMaterialSystem] = useState("电池正极体相材料");
  const [calculationType, setCalculationType] = useState("relaxation");
  const [structureText, setStructureText] = useState("");
  const [constraints, setConstraints] = useState(INITIAL_CONSTRAINTS);
  const [userNotes, setUserNotes] = useState(
    "目标工作流：材料准备 -> 参数确认 -> 计算提交 -> 结果归档。"
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
      setMessage(error instanceof Error ? error.message : "无法创建工作流会话。");
      setPending(false);
    }
  }

  return (
    <form className="panel form-grid" onSubmit={handleSubmit}>
      <div className="panel-header">
        <div>
          <p className="eyebrow">新建工作室会话</p>
          <h2>创建 DFT 工作台条目</h2>
        </div>
      </div>

      <label>
        会话标题
        <input name="title" value={title} onChange={(event) => setTitle(event.target.value)} required />
      </label>
      <label>
        研究目标
        <textarea name="goal" rows={3} value={goal} onChange={(event) => setGoal(event.target.value)} required />
      </label>
      <label>
        材料或体系类型
        <input
          name="materialSystem"
          value={materialSystem}
          onChange={(event) => setMaterialSystem(event.target.value)}
        />
      </label>
      <label>
        计算类型
        <select
          name="calculationType"
          value={calculationType}
          onChange={(event) => setCalculationType(event.target.value)}
        >
          <option value="relaxation">结构弛豫</option>
          <option value="scf">SCF</option>
          <option value="static">静态计算</option>
          <option value="dos">DOS</option>
          <option value="band structure">能带结构</option>
          <option value="single point">单点计算</option>
          <option value="surface reaction">表面反应</option>
        </select>
      </label>
      <label>
        结构 / POSCAR 文本
        <textarea
          name="structureText"
          rows={6}
          value={structureText}
          onChange={(event) => setStructureText(event.target.value)}
          placeholder="现在粘贴 POSCAR 内容，或先留空，稍后在工作室页面完成材料导入。"
        />
      </label>
      <label>
        科研人员备注
        <textarea
          name="userNotes"
          rows={3}
          value={userNotes}
          onChange={(event) => setUserNotes(event.target.value)}
          placeholder="填写 AI 必须保留为硬约束或明确审查备注的内容。"
        />
      </label>
      <label>
        可选约束 JSON
        <textarea
          rows={8}
          value={constraints}
          onChange={(event) => setConstraints(event.target.value)}
          spellCheck={false}
        />
      </label>

      <div className="inline-actions">
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? "创建中..." : "打开工作室会话"}
        </button>
        {message ? <p className="inline-message error-text">{message}</p> : null}
      </div>
    </form>
  );
}
