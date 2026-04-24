"use client";

import { useEffect, useMemo, useState } from "react";
import { KeyRound, Save, Settings2, X } from "lucide-react";

import {
  AI_CONFIG_SCOPES,
  DEFAULT_BROWSER_AI_CONFIG,
  type AiConfigScopeId,
  type BrowserAiConfig,
} from "@/lib/ai-config";

type ConfigMap = Record<AiConfigScopeId, BrowserAiConfig>;

const DEFAULT_CONFIGS: ConfigMap = Object.fromEntries(
  AI_CONFIG_SCOPES.map((scope) => [scope.id, DEFAULT_BROWSER_AI_CONFIG])
) as ConfigMap;

export function GlobalAiConfigMenu() {
  const [open, setOpen] = useState(false);
  const [activeScopeId, setActiveScopeId] = useState<AiConfigScopeId>(AI_CONFIG_SCOPES[0].id);
  const [configs, setConfigs] = useState<ConfigMap>(DEFAULT_CONFIGS);
  const [savedScope, setSavedScope] = useState<AiConfigScopeId | null>(null);

  const activeScope = useMemo(
    () => AI_CONFIG_SCOPES.find((scope) => scope.id === activeScopeId) ?? AI_CONFIG_SCOPES[0],
    [activeScopeId]
  );
  const activeConfig = configs[activeScope.id];

  useEffect(() => {
    const loaded = { ...DEFAULT_CONFIGS };
    for (const scope of AI_CONFIG_SCOPES) {
      const stored = window.localStorage.getItem(scope.storageKey);
      if (!stored) {
        continue;
      }
      try {
        loaded[scope.id] = {
          ...DEFAULT_BROWSER_AI_CONFIG,
          ...(JSON.parse(stored) as Partial<BrowserAiConfig>),
        };
      } catch {
        window.localStorage.removeItem(scope.storageKey);
      }
    }
    setConfigs(loaded);
  }, []);

  function updateConfig(next: Partial<BrowserAiConfig>) {
    setSavedScope(null);
    setConfigs((current) => ({
      ...current,
      [activeScope.id]: {
        ...current[activeScope.id],
        ...next,
      },
    }));
  }

  function saveActiveConfig() {
    window.localStorage.setItem(activeScope.storageKey, JSON.stringify(activeConfig));
    setSavedScope(activeScope.id);
  }

  return (
    <div className="global-ai-config">
      <button
        aria-expanded={open}
        className="secondary-button icon-button-label topbar-ai-button"
        onClick={() => setOpen((current) => !current)}
        title="AI 配置"
        type="button"
      >
        <Settings2 size={17} />
        AI 配置
      </button>

      {open ? (
        <div className="ai-config-popover" role="dialog" aria-label="全局 AI 配置">
          <div className="panel-header">
            <div>
              <p className="eyebrow">全局配置</p>
              <h2>AI 接口</h2>
            </div>
            <button className="icon-only-button" onClick={() => setOpen(false)} title="关闭" type="button">
              <X size={18} />
            </button>
          </div>

          <div className="tab-strip ai-scope-tabs">
            {AI_CONFIG_SCOPES.map((scope) => (
              <button
                className={`tab-pill ${activeScope.id === scope.id ? "selected-tab" : ""}`}
                key={scope.id}
                onClick={() => {
                  setActiveScopeId(scope.id);
                  setSavedScope(null);
                }}
                type="button"
              >
                {scope.title}
              </button>
            ))}
          </div>

          <div className="hint-box">
            <strong>{activeScope.title}</strong>
            <p className="support-text">{activeScope.description}</p>
          </div>

          <div className="compact-grid">
            <label className="checkbox-row">
              <input
                checked={activeConfig.enabled}
                onChange={(event) => updateConfig({ enabled: event.target.checked })}
                type="checkbox"
              />
              启用远程 AI
            </label>
            <label>
              API Base URL
              <input
                onChange={(event) => updateConfig({ baseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1"
                value={activeConfig.baseUrl}
              />
            </label>
            <label>
              模型名称
              <input
                onChange={(event) => updateConfig({ model: event.target.value })}
                placeholder="填写模型名"
                value={activeConfig.model}
              />
            </label>
            <label>
              API Key
              <div className="input-with-icon">
                <KeyRound size={16} />
                <input
                  onChange={(event) => updateConfig({ apiKey: event.target.value })}
                  placeholder="只保存在当前浏览器 localStorage"
                  type="password"
                  value={activeConfig.apiKey}
                />
              </div>
            </label>
          </div>

          <div className="inline-actions">
            <button className="primary-button icon-button-label" onClick={saveActiveConfig} type="button">
              <Save size={16} />
              保存当前配置
            </button>
            {savedScope === activeScope.id ? (
              <span className="status-pill status-completed">已保存</span>
            ) : null}
          </div>

          <p className="meta-label">
            参数确认的 RAG 数据来自本地后端知识库；没有完成计算和归档前，检索结果会为空。
          </p>
        </div>
      ) : null}
    </div>
  );
}
