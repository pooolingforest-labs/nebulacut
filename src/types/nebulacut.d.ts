export {};

type ApiKeyName =
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "GOOGLE_AI_API_KEY"
  | "BYTEPLUS_ARK_API_KEY"
  | "RUNWAY_API_KEY"
  | "HIGGSFIELD_API_KEY"
  | "HIGGSFIELD_API_SECRET";

type ApiKeys = Record<ApiKeyName, string>;
type ImportedMediaType = "video" | "audio";
type YouTubeDownloadOptions = {
  preferWebM?: boolean;
};

type ProjectSaveResult =
  | { canceled: true }
  | {
      canceled: false;
      filePath: string;
    };

type ProjectOpenResult =
  | { canceled: true }
  | {
      canceled: false;
      filePath: string;
      content: string;
    };

type YouTubeDownloadResult =
  | {
      success: true;
      filePath: string;
      fileName: string;
      mimeType: string;
      mediaType: ImportedMediaType;
      base64Data: string;
    }
  | {
      success: false;
      reason:
        | "INVALID_URL"
        | "YTDLP_NOT_FOUND"
        | "DOWNLOAD_FAILED"
        | "FILE_READ_FAILED"
        | "UNSUPPORTED_MEDIA_TYPE";
    };

type ShowInFolderResult =
  | {
      success: true;
    }
  | {
      success: false;
      reason: "INVALID_PATH" | "OPEN_FAILED";
    };

type NebulacutBridge = {
  runtime: "electron";
  settings?: {
    getApiKeys: () => Promise<ApiKeys>;
    setApiKeys: (nextKeys: ApiKeys) => Promise<ApiKeys>;
  };
  project?: {
    save: (content: string, suggestedPath: string) => Promise<ProjectSaveResult>;
    open: () => Promise<ProjectOpenResult>;
  };
  media?: {
    downloadYouTube: (url: string, options?: YouTubeDownloadOptions) => Promise<YouTubeDownloadResult>;
    showInFolder: (filePath: string) => Promise<ShowInFolderResult>;
  };
};

declare global {
  interface Window {
    nebulacut?: NebulacutBridge;
  }
}
