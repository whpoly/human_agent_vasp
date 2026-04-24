"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { ArrowRight, Boxes, CheckCircle2, Cpu, Database, Save, Settings } from "lucide-react";

import { createConnection } from "@/lib/api";
import type { KnowledgeEntry, SSHConnectionProfile, WorkflowSession } from "@/lib/types";

interface DashboardOverviewProps {
  sessions: WorkflowSession[];
  connections: SSHConnectionProfile[];
  knowledgeEntries: KnowledgeEntry[];
  warning: string | null;
}

const FLOW_GROUPS = [
  {
    title: "材料准备",
    icon: Boxes,
    description: "上传或粘贴 POSCAR/CIF，完成结构导入、预览和基础检查。",
    href: "/materials",
    actionLabel: "进入材料准备",
    tools: ["结构导入", "POSCAR 检查", "问题报告"],
  },
  {
    title: "参数确认",
    icon: Settings,
    description: "由 AI 结合本地 RAG 推荐 INCAR、KPOINTS 与 POTCAR，再人工确认最终值。",
    href: "/sessions",
    actionLabel: "进入参数确认",
    tools: ["AI 推荐", "本地 RAG", "人工确认"],
  },
  {
    title: "计算提交",
    icon: Cpu,
    description: "把已确认的参数映射到后端、资源预算和提交预检。",
    href: "/connections",
    actionLabel: "进入计算配置",
    tools: ["后端配置", "资源预算", "提交预检"],
  },
  {
    title: "结果归档",
    icon: Database,
    description: "审查计算输出，把确认后的有效案例归档到本地知识库。",
    href: "/sessions",
    actionLabel: "进入结果归档",
    tools: ["状态刷新", "输出摘要", "知识库归档"],
  },
];

const SAMPLE_POSCAR = [
  "POSCAR 尚未确认",
  "1.0",
  "  0.000000 0.000000 0.000000",
  "  0.000000 0.000000 0.000000",
  "  0.000000 0.000000 0.000000",
  "Elements",
  "Counts",
  "Direct",
].join("\n");

function countNonEmptyLines(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim()).length;
}

function buildInputPreview(poscarText: string) {
  return {
    poscar: poscarText.trim() || SAMPLE_POSCAR,
    incar: ["ENCUT = 520", "PREC = Accurate", "EDIFF = 1e-5", "ISMEAR = 0", "SIGMA = 0.05"].join("\n"),
    kpoints: ["Automatic mesh", "0", "Monkhorst-Pack", "6 6 6", "0 0 0"].join("\n"),
    potcar: ["# POTCAR guidance only", "recommended_dataset = PAW_PBE", "potcar_symbols = 请按 POSCAR 元素行确认"].join("\n"),
  };
}

function PreviewFile({ title, content }: { title: string; content: string }) {
  return (
    <article className="preview-file compact-preview-file">
      <strong>{title}</strong>
      <pre>{content}</pre>
    </article>
  );
}

export function DashboardOverview({
  sessions,
  connections,
  knowledgeEntries,
  warning,
}: DashboardOverviewProps) {
  const latestSession = sessions[0] ?? null;
  const activeSessions = sessions.filter((session) => session.status.toLowerCase() !== "completed");
  const validatedCount = knowledgeEntries.filter((entry) => entry.validated).length;
  const [localConnections, setLocalConnections] = useState(connections);
  const [poscarDraft, setPoscarDraft] = useState(latestSession?.structure_text ?? "");
  const [selectedConnectionId, setSelectedConnectionId] = useState(
    latestSession?.connection_profile_id ?? connections[0]?.id ?? ""
  );
  const [executionBackend, setExecutionBackend] = useState<"ase" | "ssh">(
    connections.length > 0 ? "ssh" : "ase"
  );
  const [launchCommand, setLaunchCommand] = useState("mpirun -np 32 vasp_std");
  const [connectionFormOpen, setConnectionFormOpen] = useState(connections.length === 0);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [inlineMessage, setInlineMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const inputPreview = useMemo(() => buildInputPreview(poscarDraft), [poscarDraft]);
  const selectedConnection = localConnections.find((connection) => connection.id === selectedConnectionId) ?? null;

  function confirmStep(stepKey: string, message: string) {
    setConfirmed((current) => ({ ...current, [stepKey]: true }));
    setInlineMessage(message);
  }

  async function handleCreateInlineConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyKey("save-connection");
    setInlineMessage(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      const connection = await createConnection({
        name: formData.get("name"),
        host: formData.get("host"),
        port: Number(formData.get("port") ?? 22),
        username: formData.get("username"),
        auth_method: formData.get("authMethod"),
        password: formData.get("password"),
        ssh_key_path: formData.get("sshKeyPath") || null,
        remote_workdir: formData.get("remoteWorkdir"),
        scheduler_type: formData.get("schedulerType"),
        scheduler_submit_command: formData.get("schedulerSubmitCommand") || null,
      });
      setLocalConnections((current) => [connection, ...current]);
      setSelectedConnectionId(connection.id);
      setExecutionBackend("ssh");
      setConnectionFormOpen(false);
      form.reset();
      setInlineMessage("连接已保存，并已选为当前计算配置。");
    } catch (error) {
      setInlineMessage(error instanceof Error ? error.message : "无法保存连接。请确认后端服务已启动。");
    } finally {
      setBusyKey(null);
    }
  }

  function renderFlowPreview(index: number) {
    if (index === 0) {
      return (
        <div className="flow-card-preview">
          <div className="inline-spread">
            <strong>材料准备预览与确认</strong>
            <span className={`status-pill ${confirmed.materials ? "status-completed" : ""}`}>
              {confirmed.materials ? "已确认" : "待确认"}
            </span>
          </div>
          <label>
            POSCAR 预览
            <textarea
              rows={6}
              value={poscarDraft}
              onChange={(event) => setPoscarDraft(event.target.value)}
              placeholder="在这里粘贴 POSCAR，确认后传给参数确认。"
            />
          </label>
          <p className="meta-label">非空行数：{countNonEmptyLines(poscarDraft)}</p>
          <button
            className="primary-button icon-button-label align-start"
            type="button"
            onClick={() => confirmStep("materials", "POSCAR 已确认，将作为参数确认的结构输入。")}
          >
            <CheckCircle2 size={16} />
            确认 POSCAR
          </button>
        </div>
      );
    }

    if (index === 1) {
      return (
        <div className="flow-card-preview">
          <div className="inline-spread">
            <strong>参数确认预览与确认</strong>
            <span className={`status-pill ${confirmed.parameters ? "status-completed" : ""}`}>
              {confirmed.parameters ? "已确认" : "待确认"}
            </span>
          </div>
          <div className="preview-file-grid">
            <PreviewFile title="INCAR" content={inputPreview.incar} />
            <PreviewFile title="KPOINTS" content={inputPreview.kpoints} />
            <PreviewFile title="POTCAR.guidance.txt" content={inputPreview.potcar} />
          </div>
          <button
            className="primary-button icon-button-label align-start"
            disabled={!confirmed.materials}
            type="button"
            onClick={() => confirmStep("parameters", "INCAR、KPOINTS 和 POTCAR 指引已确认，将传给计算提交。")}
          >
            <CheckCircle2 size={16} />
            确认输入文件
          </button>
        </div>
      );
    }

    if (index === 2) {
      return (
        <div className="flow-card-preview">
          <div className="inline-spread">
            <strong>计算确认预览与确认</strong>
            <span className={`status-pill ${confirmed.compute ? "status-completed" : ""}`}>
              {confirmed.compute ? "已确认" : "待确认"}
            </span>
          </div>
          <div className="compact-grid">
            <label>
              执行后端
              <select value={executionBackend} onChange={(event) => setExecutionBackend(event.target.value as "ase" | "ssh")}>
                <option value="ase">ASE / 本地 VASP 适配器</option>
                <option value="ssh">SSH / 调度器主机</option>
              </select>
            </label>
            <label>
              计算连接
              <select
                value={selectedConnectionId}
                onChange={(event) => setSelectedConnectionId(event.target.value)}
                disabled={executionBackend !== "ssh"}
              >
                <option value="">选择远程配置</option>
                {localConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name} ({connection.username}@{connection.host})
                  </option>
                ))}
              </select>
            </label>
            <label>
              启动命令
              <input value={launchCommand} onChange={(event) => setLaunchCommand(event.target.value)} />
            </label>
          </div>
          <div className="hint-box">
            <strong>后端信息预览</strong>
            <p className="support-text">
              {executionBackend === "ssh" && selectedConnection
                ? `${selectedConnection.username}@${selectedConnection.host}:${selectedConnection.port}`
                : executionBackend === "ssh"
                  ? "尚未选择 SSH 连接。"
                  : "将使用 ASE/VASP 本地执行路径。"}
            </p>
          </div>
          <button className="secondary-button align-start" type="button" onClick={() => setConnectionFormOpen((open) => !open)}>
            {connectionFormOpen ? "收起连接保存" : "保存新连接"}
          </button>
          {connectionFormOpen ? (
            <form className="inline-connection-form" onSubmit={handleCreateInlineConnection}>
              <div className="compact-grid">
                <label>
                  名称
                  <input name="name" defaultValue="VASP 集群" required />
                </label>
                <label>
                  主机 / IP
                  <input name="host" required />
                </label>
                <label>
                  端口
                  <input name="port" defaultValue="22" required />
                </label>
                <label>
                  用户名
                  <input name="username" required />
                </label>
                <label>
                  认证
                  <select name="authMethod" defaultValue="password">
                    <option value="password">密码</option>
                    <option value="ssh_key">SSH 私钥路径</option>
                  </select>
                </label>
                <label>
                  密码
                  <input name="password" type="password" />
                </label>
                <label>
                  SSH 私钥路径
                  <input name="sshKeyPath" placeholder="~/.ssh/id_rsa" />
                </label>
                <label>
                  远程目录
                  <input name="remoteWorkdir" defaultValue="/scratch/vasp-agent" required />
                </label>
                <label>
                  调度器
                  <select name="schedulerType" defaultValue="slurm">
                    <option value="direct">直接 shell</option>
                    <option value="slurm">SLURM</option>
                    <option value="pbs">PBS</option>
                  </select>
                </label>
              </div>
              <button className="primary-button icon-button-label align-start" disabled={busyKey === "save-connection"} type="submit">
                <Save size={16} />
                {busyKey === "save-connection" ? "保存中..." : "保存连接"}
              </button>
            </form>
          ) : null}
          <button
            className="primary-button icon-button-label align-start"
            disabled={!confirmed.parameters || (executionBackend === "ssh" && !selectedConnectionId)}
            type="button"
            onClick={() => confirmStep("compute", "后端信息已确认，将用于计算提交。")}
          >
            <CheckCircle2 size={16} />
            确认后端信息
          </button>
        </div>
      );
    }

    return (
      <div className="flow-card-preview">
        <div className="inline-spread">
          <strong>结果归档预览与确认</strong>
          <span className={`status-pill ${confirmed.archive ? "status-completed" : ""}`}>
            {confirmed.archive ? "已确认" : "待确认"}
          </span>
        </div>
        <div className="hint-box">
          <strong>后端信息</strong>
          <p className="support-text">
            {confirmed.compute
              ? `${executionBackend.toUpperCase()} / ${launchCommand}`
              : "等待计算确认后显示后端信息。"}
          </p>
        </div>
        <div className="preview-file-grid">
          <PreviewFile title="POSCAR" content={inputPreview.poscar} />
          <PreviewFile title="INCAR" content={inputPreview.incar} />
        </div>
        <button
          className="primary-button icon-button-label align-start"
          disabled={!confirmed.compute}
          type="button"
          onClick={() => confirmStep("archive", "结果归档已确认。")}
        >
          <CheckCircle2 size={16} />
          确认结果归档
        </button>
      </div>
    );
  }

  return (
    <div className="content-stack">
      <section className="page-intro">
        <div>
          <p className="eyebrow">流程首页</p>
          <h1>只从 1-4 流程进入工具。</h1>
          <p className="lede">
            主界面不再重复展示材料、工作条目、计算和 AI 配置入口；AI 配置统一在右上角，
            具体工具只在对应流程里展开。
          </p>
        </div>
        <div className="intro-status-row">
          <span className="status-pill">进行中 {activeSessions.length}</span>
          <span className="status-pill">计算连接 {connections.length}</span>
          <span className="status-pill">本地 RAG {validatedCount}</span>
        </div>
      </section>

      {warning ? <p className="panel warning-text">{warning}</p> : null}
      {inlineMessage ? <p className="panel inline-message">{inlineMessage}</p> : null}

      <section className="process-overview-grid">
        {FLOW_GROUPS.map((group, index) => {
          const Icon = group.icon;
          return (
            <article className="process-overview-card" key={group.title}>
              <div className="inline-spread">
                <span className="stage-index">{index + 1}</span>
                <Icon size={22} />
              </div>
              <div>
                <p className="eyebrow">流程</p>
                <h2>{group.title}</h2>
              </div>
              <p className="support-text">{group.description}</p>
              <div className="tag-row">
                {group.tools.map((tool) => (
                  <span className="tag-chip" key={tool}>
                    {tool}
                  </span>
                ))}
              </div>
              <Link className="secondary-link icon-button-label align-start" href={group.href}>
                {group.actionLabel}
                <ArrowRight size={16} />
              </Link>
              {renderFlowPreview(index)}
            </article>
          );
        })}
      </section>
    </div>
  );
}
