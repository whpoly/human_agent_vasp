"use client";

import { startTransition, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { createConnection, testConnection } from "@/lib/api";
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
      setMessage("Connection profile saved.");
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save connection.");
    }
  }

  async function handleTest() {
    if (!latestId) {
      setTestResult("Create or select a connection profile first.");
      return;
    }
    try {
      const result = await testConnection(latestId, {});
      setTestResult(result.ok ? `Connected: ${result.message}` : `Connection failed: ${result.message}`);
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : "Connection test failed.");
    }
  }

  return (
    <section className="content-grid">
      <form className="panel form-grid" onSubmit={handleCreate}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Remote execution</p>
            <h2>SSH connection settings</h2>
          </div>
          <button className="secondary-button" type="button" onClick={handleTest}>
            Test latest profile
          </button>
        </div>

        <label>
          Profile name
          <input name="name" defaultValue="Primary VASP cluster" required />
        </label>
        <label>
          Host / IP
          <input name="host" defaultValue="192.168.1.10" required />
        </label>
        <label>
          Port
          <input name="port" defaultValue="22" required />
        </label>
        <label>
          Username
          <input name="username" defaultValue="vaspuser" required />
        </label>
        <label>
          Authentication
          <select name="authMethod" defaultValue="password">
            <option value="password">Password</option>
            <option value="ssh_key">SSH key reference</option>
          </select>
        </label>
        <label>
          Password placeholder
          <input name="password" type="password" placeholder="Stored encrypted if provided" />
        </label>
        <label>
          SSH key reference
          <input name="sshKeyPath" placeholder="~/.ssh/id_rsa" />
        </label>
        <label>
          Remote working directory
          <input name="remoteWorkdir" defaultValue="/scratch/vasp-agent" required />
        </label>
        <label>
          Execution mode
          <select name="schedulerType" defaultValue="slurm">
            <option value="direct">Direct shell</option>
            <option value="slurm">SLURM</option>
            <option value="pbs">PBS</option>
          </select>
        </label>
        <label>
          Submit command override
          <input name="schedulerSubmitCommand" placeholder="Optional, for example sbatch run_job.sh" />
        </label>

        <div className="inline-actions">
          <button className="primary-button" type="submit">
            Save connection
          </button>
          {message ? <p className="inline-message">{message}</p> : null}
          {testResult ? <p className="inline-message">{testResult}</p> : null}
        </div>
      </form>

      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Profiles</p>
            <h2>Saved remote machines</h2>
          </div>
        </div>
        <div className="stack-list">
          {connections.length === 0 ? <p className="muted-text">No connection profiles yet.</p> : null}
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
              <span>{connection.scheduler_type}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
