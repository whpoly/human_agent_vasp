export interface BrowserAiConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export const MATERIAL_AI_CONFIG_STORAGE_KEY = "human-agent-vasp.material-ai-config";

export const DEFAULT_BROWSER_AI_CONFIG: BrowserAiConfig = {
  enabled: false,
  baseUrl: "https://api.openai.com/v1",
  model: "",
  apiKey: "",
};
