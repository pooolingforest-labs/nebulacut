const { contextBridge, ipcRenderer } = require("electron");

const API_KEY_NAMES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_AI_API_KEY",
  "BYTEPLUS_ARK_API_KEY",
  "RUNWAY_API_KEY",
  "HIGGSFIELD_API_KEY",
  "HIGGSFIELD_API_SECRET",
];

function createEmptyApiKeys() {
  return {
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    GOOGLE_AI_API_KEY: "",
    BYTEPLUS_ARK_API_KEY: "",
    RUNWAY_API_KEY: "",
    HIGGSFIELD_API_KEY: "",
    HIGGSFIELD_API_SECRET: "",
  };
}

function normalizeApiKeys(input) {
  const normalized = createEmptyApiKeys();
  const source = input && typeof input === "object" ? input : {};

  for (const key of API_KEY_NAMES) {
    const value = source[key];
    normalized[key] = typeof value === "string" ? value.trim() : "";
  }

  return normalized;
}

contextBridge.exposeInMainWorld("nebulacut", {
  runtime: "electron",
  settings: {
    getApiKeys: async () => {
      const result = await ipcRenderer.invoke("settings:getApiKeys");
      return normalizeApiKeys(result);
    },
    setApiKeys: async (nextKeys) => {
      const result = await ipcRenderer.invoke(
        "settings:setApiKeys",
        normalizeApiKeys(nextKeys),
      );
      return normalizeApiKeys(result);
    },
  },
  project: {
    save: async (content, suggestedPath) => {
      return ipcRenderer.invoke("project:save", content, suggestedPath);
    },
    open: async () => {
      return ipcRenderer.invoke("project:open");
    },
  },
  media: {
    downloadYouTube: async (url, options) => {
      return ipcRenderer.invoke("media:downloadYouTube", url, options);
    },
    showInFolder: async (filePath) => {
      return ipcRenderer.invoke("media:showInFolder", filePath);
    },
  },
});
