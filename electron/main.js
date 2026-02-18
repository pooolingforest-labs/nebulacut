import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_KEY_NAMES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_AI_API_KEY",
  "BYTEPLUS_ARK_API_KEY",
  "RUNWAY_API_KEY",
  "HIGGSFIELD_API_KEY",
  "HIGGSFIELD_API_SECRET",
];
const PROJECT_FILE_EXTENSION = "nbcut";
const PROJECT_FILE_DEFAULT_NAME = `untitled.${PROJECT_FILE_EXTENSION}`;
const YOUTUBE_MEDIA_DIRECTORY_NAME = "NebulaCut";

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".mkv",
  ".mov",
  ".m4v",
  ".avi",
  ".mpeg",
  ".mpg",
  ".3gp",
]);

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".flac",
  ".ogg",
  ".opus",
  ".weba",
  ".oga",
]);

const MIME_BY_EXTENSION = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".avi": "video/x-msvideo",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".3gp": "video/3gpp",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".weba": "audio/webm",
  ".oga": "audio/ogg",
};

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

function normalizeYouTubeUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (!YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function getYouTubeMediaDirectoryPath() {
  return path.join(app.getPath("downloads"), YOUTUBE_MEDIA_DIRECTORY_NAME);
}

function detectMediaTypeByExtension(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  return null;
}

function detectMimeTypeByExtension(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function runYtDlpDownload(youtubeUrl, outputTemplate) {
  return new Promise((resolve, reject) => {
    const args = [
      "--no-playlist",
      "--no-progress",
      "--no-warnings",
      "--restrict-filenames",
      "--print",
      "after_move:filepath",
      "-o",
      outputTemplate,
      youtubeUrl,
    ];

    execFile("yt-dlp", args, { maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const normalizedError = Object.assign(new Error("yt-dlp failed"), {
          code: error.code,
          stderr,
        });
        reject(normalizedError);
        return;
      }

      const filePath = stdout
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean)
        .pop();

      if (!filePath) {
        const normalizedError = Object.assign(new Error("yt-dlp output is empty"), {
          code: "EMPTY_OUTPUT",
          stderr,
        });
        reject(normalizedError);
        return;
      }

      resolve(filePath);
    });
  });
}

function getSettingsFilePath() {
  return path.join(app.getPath("userData"), "ai-provider-keys.json");
}

async function readApiKeysFromDisk() {
  try {
    const fileContent = await readFile(getSettingsFilePath(), "utf8");
    const parsed = JSON.parse(fileContent);
    return normalizeApiKeys(parsed);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return createEmptyApiKeys();
    }
    console.error("[settings] Failed to load API keys.", error);
    return createEmptyApiKeys();
  }
}

async function writeApiKeysToDisk(input) {
  const normalized = normalizeApiKeys(input);
  const filePath = getSettingsFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

ipcMain.handle("settings:getApiKeys", async () => {
  return readApiKeysFromDisk();
});

ipcMain.handle("settings:setApiKeys", async (_event, nextKeys) => {
  return writeApiKeysToDisk(nextKeys);
});

ipcMain.handle("project:save", async (_event, content, suggestedPath) => {
  if (typeof content !== "string") {
    throw new Error("Project content must be a string.");
  }

  const normalizedSuggestedPath =
    typeof suggestedPath === "string" && suggestedPath.trim().length > 0
      ? suggestedPath.trim()
      : PROJECT_FILE_DEFAULT_NAME;
  const defaultPath = path.isAbsolute(normalizedSuggestedPath)
    ? normalizedSuggestedPath
    : path.join(app.getPath("documents"), path.basename(normalizedSuggestedPath));

  const result = await dialog.showSaveDialog({
    title: "Save Project",
    defaultPath,
    filters: [
      { name: "NebulaCut Project", extensions: [PROJECT_FILE_EXTENSION] },
      { name: "JSON", extensions: ["json"] },
    ],
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  const extension = path.extname(result.filePath);
  const targetPath = extension ? result.filePath : `${result.filePath}.${PROJECT_FILE_EXTENSION}`;
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");

  return { canceled: false, filePath: targetPath };
});

ipcMain.handle("project:open", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open Project",
    properties: ["openFile"],
    filters: [
      { name: "NebulaCut Project", extensions: [PROJECT_FILE_EXTENSION] },
      { name: "JSON", extensions: ["json"] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const [filePath] = result.filePaths;
  const content = await readFile(filePath, "utf8");
  return {
    canceled: false,
    filePath,
    content,
  };
});

ipcMain.handle("media:downloadYouTube", async (_event, rawUrl) => {
  const normalizedUrl = normalizeYouTubeUrl(rawUrl);
  if (!normalizedUrl) {
    return {
      success: false,
      reason: "INVALID_URL",
    };
  }

  const outputDirectory = getYouTubeMediaDirectoryPath();
  const outputTemplate = path.join(outputDirectory, "%(title).160B-%(id)s.%(ext)s");

  await mkdir(outputDirectory, { recursive: true });

  let downloadedFilePath = "";
  try {
    downloadedFilePath = await runYtDlpDownload(normalizedUrl, outputTemplate);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {
        success: false,
        reason: "YTDLP_NOT_FOUND",
      };
    }
    console.error("[media] Failed to download YouTube media.", error);
    return {
      success: false,
      reason: "DOWNLOAD_FAILED",
    };
  }

  const resolvedDownloadedFilePath = path.isAbsolute(downloadedFilePath)
    ? downloadedFilePath
    : path.join(outputDirectory, downloadedFilePath);

  const mediaType = detectMediaTypeByExtension(resolvedDownloadedFilePath);
  if (!mediaType) {
    return {
      success: false,
      reason: "UNSUPPORTED_MEDIA_TYPE",
    };
  }

  try {
    const binary = await readFile(resolvedDownloadedFilePath);
    return {
      success: true,
      filePath: resolvedDownloadedFilePath,
      fileName: path.basename(resolvedDownloadedFilePath),
      mimeType: detectMimeTypeByExtension(resolvedDownloadedFilePath),
      mediaType,
      base64Data: binary.toString("base64"),
    };
  } catch (error) {
    console.error("[media] Failed to read downloaded YouTube media.", error);
    return {
      success: false,
      reason: "FILE_READ_FAILED",
    };
  }
});

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1460,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#020617",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    window.loadURL(devServerUrl);
  } else {
    window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
