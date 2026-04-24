"use client";

import { startTransition, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { createConnection, testConnection } from "@/lib/api";
import { formatSchedulerType } from "@/lib/studio";
import type { SSHConnectionProfile } from "@/lib/types";

interface ConnectionFormProps {
  initialConnections: SSHConnectionProfile[];
}

export function ConnectionForm({ initialConnections }: ConnectionFormProps) {
  const router = useRouter();
  const [connections, setConnections] = useState(initialConnections);
  const [message, setMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [latestId, setLatestId] = useState<string | null>(connections[0]?.id ?? null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      const formData = new FormData(event.currentTarget);
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
        scheduler_submit_command: formData.get("schedulerSubmitCommand") || null
      });
      setConnections((current) => [connection, ...current]);
      setLatestId(connection.id);
      setMessage("连接配置已保存。");
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法保存连接配置。");
    }
  }

  async function handleTest() {
    if (!latestId) {
      setTestResult("请先创建或选择一个连接配置。");
      return;
    }
    try {
      const result = await testConnection(latestId, {});
      setTestResult(result.ok ? `已连接：${result.message}` : `连接失败：${result.message}`);
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : "连接测试失败。");
    }
  }

  return (
    <section className="content-grid">
      <form className="panel form-grid" onSubmit={handleCreate}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">计算连接器</p>
            <h2>DFT 后端连接设置</h2>
          </div>
          <button className="secondary-button" type="button" onClick={handleTest}>
            测试最新配置
          </button>
        </div>

        <label>
          配置名称
          <input name="name" defaultValue="主 VASP 集群" required />
        </label>
        <label>
          主机 / IP
          <input name="host" defaultValue="192.168.1.10" required />
        </label>
        <label>
          端口
          <input name="port" defaultValue="22" required />
        </label>
        <label>
          用户名
          <input name="username" defaultValue="vaspuser" required />
        </label>
        <label>
          认证方式
          <select name="authMethod" defaultValue="password">
            <option value="password">密码</option>
            <option value="ssh_key">SSH 密钥引用</option>
          </select>
        </label>
        <label>
          密码占位
          <input name="password" type="password" placeholder="如提供，将加密保存" />
        </label>
        <label>
          SSH 密钥引用
          <input name="sshKeyPath" placeholder="~/.ssh/id_rsa" />
        </label>
        <label>
          远程工作目录
          <input name="remoteWorkdir" defaultValue="/scratch/vasp-agent" required />
        </label>
        <label>
          执行模式
          <select name="schedulerType" defaultValue="slurm">
            <option value="direct">直接 shell</option>
            <option value="slurm">SLURM</option>
            <option value="pbs">PBS</option>
          </select>
        </label>
        <label>
          提交命令覆盖
          <input name="schedulerSubmitCommand" placeholder="可选，例如 sbatch run_job.sh" />
        </label>

        <div className="inline-actions">
          <button className="primary-button" type="submit">
            保存连接
          </button>
          {message ? <p className="inline-message">{message}</p> : null}
          {testResult ? <p className="inline-message">{testResult}</p> : null}
        </div>
      </form>

      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">配置</p>
            <h2>已保存计算目标</h2>
          </div>
        </div>
        <div className="stack-list">
          {connections.length === 0 ? <p className="muted-text">还没有连接配置。</p> : null}
          {connections.map((connection) => (
            <button
              className={`connection-card ${latestId === connection.id ? "selected-card" : ""}`}
              key={connection.id}
              onClick={() => setLatestId(connection.id)}
              type="button"
            >
              <strong>{connection.name}</strong>
              <span>
                {connection.username}@{connection.host}:{connection.port}
              </span>
              <span>{formatSchedulerType(connection.scheduler_type)}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
