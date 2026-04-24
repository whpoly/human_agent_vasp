"use client";

import { useEffect, useState } from "react";
import { Bot, KeyRound, Save } from "lucide-react";

import {
  DEFAULT_BROWSER_AI_CONFIG,
  MATERIAL_AI_CONFIG_STORAGE_KEY,
  type BrowserAiConfig,
} from "@/lib/ai-config";

export function AiConfigPanel() {
  const [config, setConfig] = useState<BrowserAiConfig>(DEFAULT_BROWSER_AI_CONFIG);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(MATERIAL_AI_CONFIG_STORAGE_KEY);
    if (!stored) {
      return;
    }
    try {
      setConfig({ ...DEFAULT_BROWSER_AI_CONFIG, ...(JSON.parse(stored) as Partial<BrowserAiConfig>) });
    } catch {
      window.localStorage.removeItem(MATERIAL_AI_CONFIG_STORAGE_KEY);
    }
  }, []);

  function updateConfig(next: Partial<BrowserAiConfig>) {
    setSaved(false);
    setConfig((current) => ({ ...current, ...next }));
  }

  function saveConfig() {
    window.localStorage.setItem(MATERIAL_AI_CONFIG_STORAGE_KEY, JSON.stringify(config));
    setSaved(true);
  }

  return (
    <article className="panel form-grid ai-config-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">AI 操作配置</p>
          <h2>材料工作台接口</h2>
        </div>
        <Bot size={26} />
      </div>
      <p className="support-text">
        这里保存浏览器端的 OpenAI 兼容接口配置。材料工作台会优先调用该接口生成结构操作；没有配置时会使用本地指令解析器。
      </p>
      <div className="compact-grid">
        <label className="checkbox-row">
          <input
            checked={config.enabled}
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
            value={config.baseUrl}
          />
        </label>
        <label>
          模型名称
          <input
            onChange={(event) => updateConfig({ model: event.target.value })}
            placeholder="填写你的模型名"
            value={config.model}
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
              value={config.apiKey}
            />
          </div>
        </label>
      </div>
      <div className="inline-actions">
        <button className="primary-button icon-button-label" onClick={saveConfig} type="button">
          <Save size={16} />
          保存 AI 配置
        </button>
        {saved ? <span className="status-pill status-completed">已保存</span> : null}
      </div>
    </article>
  );
}
