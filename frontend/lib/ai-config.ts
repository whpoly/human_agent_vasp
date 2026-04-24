export interface BrowserAiConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export const MATERIAL_AI_CONFIG_STORAGE_KEY = "human-agent-vasp.material-ai-config";
export const PARAMETER_AI_CONFIG_STORAGE_KEY = "human-agent-vasp.parameter-ai-config";

export type AiConfigScopeId = "materials" | "parameters";

export interface AiConfigScope {
  id: AiConfigScopeId;
  title: string;
  description: string;
  storageKey: string;
}

export const AI_CONFIG_SCOPES: AiConfigScope[] = [
  {
    id: "materials",
    title: "材料准备 AI",
    description: "用于材料工作台里的自然语言结构操作解析。",
    storageKey: MATERIAL_AI_CONFIG_STORAGE_KEY,
  },
  {
    id: "parameters",
    title: "参数确认 AI",
    description: "用于参数推荐模块；当前建议先经过后端本地 RAG 检索。",
    storageKey: PARAMETER_AI_CONFIG_STORAGE_KEY,
  },
];

export const DEFAULT_BROWSER_AI_CONFIG: BrowserAiConfig = {
  enabled: false,
  baseUrl: "https://api.openai.com/v1",
  model: "",
  apiKey: "",
};
