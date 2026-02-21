import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent as ReactChangeEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  HiOutlineCog6Tooth,
  HiOutlineMusicalNote,
  HiOutlinePause,
  HiOutlinePhoto,
  HiOutlinePlay,
  HiOutlinePlus,
  HiOutlineScissors,
  HiOutlineTrash,
  HiOutlineVideoCamera,
} from "react-icons/hi2";
import { useI18n, type LocalePreference } from "./i18n";

type MediaType = "video" | "audio" | "image";
type TrackType = "video" | "audio";

type MediaAsset = {
  id: string;
  type: MediaType;
  name: string;
  file: File;
  url: string;
  duration: number;
  width?: number;
  height?: number;
  sourcePath?: string;
  hasAudioTrack?: boolean;
};

type Track = {
  id: string;
  name: string;
  type: TrackType;
};

type Clip = {
  id: string;
  trackId: string;
  assetId: string;
  start: number;
  offset: number;
  duration: number;
  gain: number;
};

type DragMode = "move" | "trim-start" | "trim-end";

type DragState = {
  clipId: string;
  mode: DragMode;
  startX: number;
  startStart: number;
  startOffset: number;
  startDuration: number;
};

const MIN_CLIP_DURATION = 0.2;
const EMPTY_TIMELINE_DURATION = 12;
const DEFAULT_IMAGE_DURATION = 5;
const API_KEYS_STORAGE_KEY = "nebulacut.aiProviderKeys";
const TIMELINE_ZOOM_HARD_MIN = 8;
const TIMELINE_ZOOM_HARD_MAX = 640;
const TIMELINE_ZOOM_EMPTY_MIN = 40;
const TIMELINE_ZOOM_EMPTY_MAX = 160;
const DEFAULT_TIMELINE_ZOOM = 75;
const PROJECT_FILE_KIND = "nebulacut.project";
const PROJECT_FILE_VERSION = 1;
const PROJECT_FILE_EXTENSION = ".nbcut";

type ApiKeyName =
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "GOOGLE_AI_API_KEY"
  | "BYTEPLUS_ARK_API_KEY"
  | "RUNWAY_API_KEY"
  | "HIGGSFIELD_API_KEY"
  | "HIGGSFIELD_API_SECRET";

type ApiKeys = Record<ApiKeyName, string>;
type SettingsTab = "general" | "aiProviders";
type SerializedMediaAsset = {
  id: string;
  type: MediaType;
  name: string;
  mimeType: string;
  dataUrl: string;
  sourcePath?: string;
  hasAudioTrack?: boolean;
};

type ProjectStateSnapshot = {
  assets: MediaAsset[];
  tracks: Track[];
  clips: Clip[];
  selectedClipId: string | null;
  playhead: number;
  pixelsPerSecond: number;
};

type SerializedProjectState = {
  assets: SerializedMediaAsset[];
  tracks: Track[];
  clips: Clip[];
  selectedClipId: string | null;
  playhead: number;
  pixelsPerSecond: number;
};

type NebulaCutProjectFile = {
  kind: typeof PROJECT_FILE_KIND;
  version: typeof PROJECT_FILE_VERSION;
  savedAt: string;
  state: SerializedProjectState;
};

const API_KEY_FIELD_ORDER: ApiKeyName[] = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_AI_API_KEY",
  "BYTEPLUS_ARK_API_KEY",
  "RUNWAY_API_KEY",
  "HIGGSFIELD_API_KEY",
  "HIGGSFIELD_API_SECRET",
];

const EMPTY_API_KEYS: ApiKeys = {
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  GOOGLE_AI_API_KEY: "",
  BYTEPLUS_ARK_API_KEY: "",
  RUNWAY_API_KEY: "",
  HIGGSFIELD_API_KEY: "",
  HIGGSFIELD_API_SECRET: "",
};

type ApiKeysNotice = "loadError" | "saved" | "saveError";

function normalizeApiKeys(input: unknown): ApiKeys {
  const source =
    input && typeof input === "object"
      ? (input as Partial<Record<ApiKeyName, unknown>>)
      : {};

  return {
    OPENAI_API_KEY: typeof source.OPENAI_API_KEY === "string" ? source.OPENAI_API_KEY : "",
    ANTHROPIC_API_KEY:
      typeof source.ANTHROPIC_API_KEY === "string" ? source.ANTHROPIC_API_KEY : "",
    GOOGLE_AI_API_KEY:
      typeof source.GOOGLE_AI_API_KEY === "string" ? source.GOOGLE_AI_API_KEY : "",
    BYTEPLUS_ARK_API_KEY:
      typeof source.BYTEPLUS_ARK_API_KEY === "string" ? source.BYTEPLUS_ARK_API_KEY : "",
    RUNWAY_API_KEY: typeof source.RUNWAY_API_KEY === "string" ? source.RUNWAY_API_KEY : "",
    HIGGSFIELD_API_KEY:
      typeof source.HIGGSFIELD_API_KEY === "string" ? source.HIGGSFIELD_API_KEY : "",
    HIGGSFIELD_API_SECRET:
      typeof source.HIGGSFIELD_API_SECRET === "string" ? source.HIGGSFIELD_API_SECRET : "",
  };
}

function createDefaultTracks(): Track[] {
  return [
    { id: generateId(), name: "V1", type: "video" },
    { id: generateId(), name: "A1", type: "audio" },
  ];
}

function generateId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

type TimelineZoomRange = {
  min: number;
  max: number;
};

function getTimelineZoomRange(clips: Clip[]): TimelineZoomRange {
  if (clips.length === 0) {
    return {
      min: TIMELINE_ZOOM_EMPTY_MIN,
      max: TIMELINE_ZOOM_EMPTY_MAX,
    };
  }

  let maxTimelineEnd = EMPTY_TIMELINE_DURATION;
  let minClipDuration = Number.POSITIVE_INFINITY;

  for (const clip of clips) {
    maxTimelineEnd = Math.max(maxTimelineEnd, clip.start + clip.duration);
    if (clip.duration > 0) {
      minClipDuration = Math.min(minClipDuration, clip.duration);
    }
  }

  if (!Number.isFinite(minClipDuration)) {
    minClipDuration = MIN_CLIP_DURATION;
  }

  // Zoom-out lower bound: keep whole timeline navigable while tiny clips remain visible.
  const minByTimeline = 360 / maxTimelineEnd;
  const minByShortestClip = 2 / minClipDuration;
  let min = clamp(
    Math.max(minByTimeline, minByShortestClip),
    TIMELINE_ZOOM_HARD_MIN,
    120,
  );

  // Zoom-in upper bound: let the shortest clip be expanded for detailed edits.
  let max = clamp(
    320 / minClipDuration,
    TIMELINE_ZOOM_EMPTY_MAX,
    TIMELINE_ZOOM_HARD_MAX,
  );

  if (max < min + 20) {
    max = clamp(min + 20, TIMELINE_ZOOM_EMPTY_MAX, TIMELINE_ZOOM_HARD_MAX);
    if (max <= min) {
      min = Math.max(TIMELINE_ZOOM_HARD_MIN, max - 20);
    }
  }

  return { min, max };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isMediaType(value: unknown): value is MediaType {
  return value === "video" || value === "audio" || value === "image";
}

function isTrackType(value: unknown): value is TrackType {
  return value === "video" || value === "audio";
}

function getFileNameFromPath(pathLike: string) {
  const chunks = pathLike.split(/[\\/]/);
  const fallback = `untitled${PROJECT_FILE_EXTENSION}`;
  return chunks[chunks.length - 1] || fallback;
}

type FileWithOptionalPath = File & {
  path?: string;
};

function getFilePathFromFile(file: File) {
  const pathCandidate = (file as FileWithOptionalPath).path;
  if (typeof pathCandidate !== "string") return null;
  const normalized = pathCandidate.trim();
  return normalized.length > 0 ? normalized : null;
}

function withProjectExtension(name: string) {
  return name.endsWith(PROJECT_FILE_EXTENSION) ? name : `${name}${PROJECT_FILE_EXTENSION}`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }
      reject(new Error("Invalid file read result."));
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(dataUrl: string, name: string, mimeType: string) {
  const [header, payload] = dataUrl.split(",", 2);
  if (!header || !payload || !header.startsWith("data:")) {
    throw new Error("Invalid data URL.");
  }

  const headerMimeType = header.slice(5).split(";")[0];
  const resolvedMimeType = mimeType || headerMimeType || "application/octet-stream";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], name, { type: resolvedMimeType });
}

function base64ToFile(base64Data: string, name: string, mimeType: string) {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], name, { type: mimeType || "application/octet-stream" });
}

function parseProjectFile(content: string): NebulaCutProjectFile | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.kind !== PROJECT_FILE_KIND || parsed.version !== PROJECT_FILE_VERSION) {
    return null;
  }

  const state = parsed.state;
  if (!isRecord(state)) return null;

  if (!Array.isArray(state.assets) || !Array.isArray(state.tracks) || !Array.isArray(state.clips)) {
    return null;
  }

  const assets: SerializedMediaAsset[] = [];
  for (const item of state.assets) {
    if (!isRecord(item)) return null;
    if (
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.mimeType !== "string" ||
      typeof item.dataUrl !== "string" ||
      !isMediaType(item.type)
    ) {
      return null;
    }
    assets.push({
      id: item.id,
      type: item.type,
      name: item.name,
      mimeType: item.mimeType,
      dataUrl: item.dataUrl,
      sourcePath:
        typeof item.sourcePath === "string" && item.sourcePath.trim().length > 0
          ? item.sourcePath.trim()
          : undefined,
      hasAudioTrack: typeof item.hasAudioTrack === "boolean" ? item.hasAudioTrack : undefined,
    });
  }

  const tracks: Track[] = [];
  for (const item of state.tracks) {
    if (!isRecord(item)) return null;
    if (typeof item.id !== "string" || typeof item.name !== "string" || !isTrackType(item.type)) {
      return null;
    }
    tracks.push({
      id: item.id,
      name: item.name,
      type: item.type,
    });
  }

  const clips: Clip[] = [];
  for (const item of state.clips) {
    if (!isRecord(item)) return null;
    if (
      typeof item.id !== "string" ||
      typeof item.trackId !== "string" ||
      typeof item.assetId !== "string" ||
      !isFiniteNumber(item.start) ||
      !isFiniteNumber(item.offset) ||
      !isFiniteNumber(item.duration) ||
      !isFiniteNumber(item.gain)
    ) {
      return null;
    }
    clips.push({
      id: item.id,
      trackId: item.trackId,
      assetId: item.assetId,
      start: item.start,
      offset: item.offset,
      duration: item.duration,
      gain: item.gain,
    });
  }

  const selectedClipId = typeof state.selectedClipId === "string" ? state.selectedClipId : null;
  const playhead = isFiniteNumber(state.playhead) ? Math.max(0, state.playhead) : 0;
  const timelineZoomRange = getTimelineZoomRange(clips);
  const pixelsPerSecond = isFiniteNumber(state.pixelsPerSecond)
    ? clamp(state.pixelsPerSecond, timelineZoomRange.min, timelineZoomRange.max)
    : clamp(DEFAULT_TIMELINE_ZOOM, timelineZoomRange.min, timelineZoomRange.max);
  const savedAt = typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString();

  return {
    kind: PROJECT_FILE_KIND,
    version: PROJECT_FILE_VERSION,
    savedAt,
    state: {
      assets,
      tracks,
      clips,
      selectedClipId,
      playhead,
      pixelsPerSecond,
    },
  };
}

function formatTime(value: number, twoDigitNumberFormatter: Intl.NumberFormat) {
  if (!Number.isFinite(value)) return "--:--";
  const total = Math.max(0, value);
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  const hundredths = Math.floor((total % 1) * 100);
  return `${twoDigitNumberFormatter.format(minutes)}:${twoDigitNumberFormatter.format(
    seconds,
  )}.${twoDigitNumberFormatter.format(hundredths)}`;
}

type LoadMediaErrorMessages = {
  imageMetaLoad: string;
  mediaMetaLoad: string;
};

type VideoElementWithAudioMetadata = HTMLVideoElement & {
  audioTracks?: { length: number };
  mozHasAudio?: boolean;
  webkitAudioDecodedByteCount?: number;
  captureStream?: () => MediaStream;
};

function detectVideoHasAudioTrack(video: HTMLVideoElement) {
  const metadata = video as VideoElementWithAudioMetadata;

  const audioTrackCount = metadata.audioTracks?.length;
  if (typeof audioTrackCount === "number") {
    return audioTrackCount > 0;
  }

  if (typeof metadata.mozHasAudio === "boolean") {
    return metadata.mozHasAudio;
  }

  if (
    typeof metadata.webkitAudioDecodedByteCount === "number" &&
    Number.isFinite(metadata.webkitAudioDecodedByteCount)
  ) {
    return metadata.webkitAudioDecodedByteCount > 0;
  }

  if (typeof metadata.captureStream === "function") {
    try {
      const stream = metadata.captureStream();
      const hasAudio = stream.getAudioTracks().length > 0;
      stream.getTracks().forEach((track) => track.stop());
      return hasAudio;
    } catch {
      return false;
    }
  }

  return false;
}

async function loadMediaAsset(
  file: File,
  type: MediaType,
  errorMessages: LoadMediaErrorMessages,
): Promise<MediaAsset> {
  const url = URL.createObjectURL(file);

  if (type === "image") {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        resolve({
          id: generateId(),
          type,
          name: file.name,
          file,
          url,
          duration: DEFAULT_IMAGE_DURATION,
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(errorMessages.imageMetaLoad));
      };
      image.src = url;
    });
  }

  const element =
    type === "video" ? document.createElement("video") : document.createElement("audio");
  element.preload = "metadata";
  element.src = url;

  return new Promise((resolve, reject) => {
    element.onloadedmetadata = () => {
      const duration = Number.isFinite(element.duration) ? Math.max(element.duration, 0) : 0;
      const asset: MediaAsset = {
        id: generateId(),
        type,
        name: file.name,
        file,
        url,
        duration,
      };

      if (type === "video") {
        const video = element as HTMLVideoElement;
        asset.width = video.videoWidth;
        asset.height = video.videoHeight;
        asset.hasAudioTrack = detectVideoHasAudioTrack(video);
      }

      resolve(asset);
    };

    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(errorMessages.mediaMetaLoad));
    };
  });
}

export default function App() {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [tracks, setTracks] = useState<Track[]>(createDefaultTracks);
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_TIMELINE_ZOOM);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("aiProviders");
  const [apiKeys, setApiKeys] = useState<ApiKeys>(EMPTY_API_KEYS);
  const [isLoadingApiKeys, setIsLoadingApiKeys] = useState(false);
  const [isSavingApiKeys, setIsSavingApiKeys] = useState(false);
  const [apiKeysNotice, setApiKeysNotice] = useState<ApiKeysNotice | null>(null);
  const [projectFilePath, setProjectFilePath] = useState<string | null>(null);
  const [projectFileName, setProjectFileName] = useState<string | null>(null);
  const [isProjectBusy, setIsProjectBusy] = useState(false);
  const [isMediaImportMenuOpen, setIsMediaImportMenuOpen] = useState(false);
  const [isYouTubeDialogOpen, setIsYouTubeDialogOpen] = useState(false);
  const [youtubeUrlInput, setYoutubeUrlInput] = useState("");
  const [isDownloadingYouTube, setIsDownloadingYouTube] = useState(false);
  const [youtubeDialogNotice, setYoutubeDialogNotice] = useState<string | null>(null);

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const mediaImportMenuRef = useRef<HTMLDivElement | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const timelineInnerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const scrubPointerIdRef = useRef<number | null>(null);
  const activeVideoClipRef = useRef<string | null>(null);
  const pendingVideoSeekRef = useRef<number | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const assetsRef = useRef<MediaAsset[]>([]);
  const { locale, localePreference, setLocalePreference, systemLocale, t, formatNumber } =
    useI18n();
  const isElectronRuntime = window.nebulacut?.runtime === "electron";

  const twoDigitNumberFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        minimumIntegerDigits: 2,
        useGrouping: false,
      }),
    [locale],
  );

  const formatTimeLabel = useCallback(
    (value: number) => formatTime(value, twoDigitNumberFormatter),
    [twoDigitNumberFormatter],
  );

  const mediaLoadErrors = useMemo<LoadMediaErrorMessages>(
    () => ({
      imageMetaLoad: t("errors.imageMetaLoad"),
      mediaMetaLoad: t("errors.mediaMetaLoad"),
    }),
    [t],
  );

  const getAssetTypeLabel = useCallback(
    (type: MediaType) => {
      if (type === "video") return t("asset.video");
      if (type === "audio") return t("asset.audio");
      return t("asset.image");
    },
    [t],
  );

  const getTrackTypeLabel = useCallback(
    (type: TrackType) => {
      if (type === "video") return t("track.type.video");
      return t("track.type.audio");
    },
    [t],
  );

  const loadApiKeys = useCallback(async () => {
    setIsLoadingApiKeys(true);
    setApiKeysNotice(null);

    try {
      if (window.nebulacut?.settings) {
        const loaded = await window.nebulacut.settings.getApiKeys();
        setApiKeys(normalizeApiKeys(loaded));
      } else {
        const raw = window.localStorage.getItem(API_KEYS_STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        setApiKeys(normalizeApiKeys(parsed));
      }
    } catch (error) {
      console.error("[settings] Failed to load API keys.", error);
      setApiKeysNotice("loadError");
    } finally {
      setIsLoadingApiKeys(false);
    }
  }, []);

  const handleSaveApiKeys = useCallback(async () => {
    setIsSavingApiKeys(true);
    setApiKeysNotice(null);

    try {
      if (window.nebulacut?.settings) {
        const saved = await window.nebulacut.settings.setApiKeys(apiKeys);
        setApiKeys(normalizeApiKeys(saved));
      } else {
        window.localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(apiKeys));
      }

      setApiKeysNotice("saved");
    } catch (error) {
      console.error("[settings] Failed to save API keys.", error);
      setApiKeysNotice("saveError");
    } finally {
      setIsSavingApiKeys(false);
    }
  }, [apiKeys]);

  useEffect(() => {
    void loadApiKeys();
  }, [loadApiKeys]);

  const apiKeysNoticeMessage = useMemo(() => {
    if (apiKeysNotice === "saved") return t("settings.notice.saved");
    if (apiKeysNotice === "saveError") return t("settings.notice.saveError");
    if (apiKeysNotice === "loadError") return t("settings.notice.loadError");
    return null;
  }, [apiKeysNotice, t]);

  const projectDisplayName = useMemo(
    () => projectFileName ?? t("project.untitled"),
    [projectFileName, t],
  );

  const replaceProjectState = useCallback((nextState: ProjectStateSnapshot) => {
    setIsPlaying(false);
    dragStateRef.current = null;
    scrubPointerIdRef.current = null;
    activeVideoClipRef.current = null;
    pendingVideoSeekRef.current = null;
    audioElementsRef.current.forEach((audio) => audio.pause());
    audioElementsRef.current.clear();

    setAssets((prev) => {
      prev.forEach((asset) => URL.revokeObjectURL(asset.url));
      return nextState.assets;
    });
    setTracks(nextState.tracks.length > 0 ? nextState.tracks : createDefaultTracks());
    setClips(nextState.clips);
    setSelectedClipId(nextState.selectedClipId);
    setPlayhead(Math.max(0, nextState.playhead));
    const timelineZoomRange = getTimelineZoomRange(nextState.clips);
    setPixelsPerSecond(
      clamp(nextState.pixelsPerSecond, timelineZoomRange.min, timelineZoomRange.max),
    );
  }, []);

  const loadProjectContent = useCallback(
    async (content: string, sourcePathOrName: string | null) => {
      const parsedProject = parseProjectFile(content);
      if (!parsedProject) {
        throw new Error(t("project.notice.invalidFile"));
      }

      const loadedAssets: MediaAsset[] = [];
      try {
        for (const serializedAsset of parsedProject.state.assets) {
          let file: File;
          try {
            file = dataUrlToFile(
              serializedAsset.dataUrl,
              serializedAsset.name,
              serializedAsset.mimeType,
            );
          } catch {
            throw new Error(t("project.notice.invalidFile"));
          }

          const loadedAsset = await loadMediaAsset(file, serializedAsset.type, mediaLoadErrors);
          loadedAssets.push({
            ...loadedAsset,
            id: serializedAsset.id,
            name: serializedAsset.name,
            sourcePath: serializedAsset.sourcePath,
            hasAudioTrack: serializedAsset.hasAudioTrack ?? loadedAsset.hasAudioTrack,
          });
        }
      } catch (error) {
        loadedAssets.forEach((asset) => URL.revokeObjectURL(asset.url));
        throw error;
      }

      const nextTracks =
        parsedProject.state.tracks.length > 0
          ? parsedProject.state.tracks
          : createDefaultTracks();
      const trackIds = new Set(nextTracks.map((track) => track.id));
      const assetIds = new Set(loadedAssets.map((asset) => asset.id));
      const nextClips = parsedProject.state.clips.filter((clip) => {
        if (!trackIds.has(clip.trackId) || !assetIds.has(clip.assetId)) return false;
        if (clip.start < 0 || clip.offset < 0 || clip.duration < MIN_CLIP_DURATION) return false;
        return true;
      });
      const nextSelectedClipId =
        parsedProject.state.selectedClipId &&
        nextClips.some((clip) => clip.id === parsedProject.state.selectedClipId)
          ? parsedProject.state.selectedClipId
          : null;

      replaceProjectState({
        assets: loadedAssets,
        tracks: nextTracks,
        clips: nextClips,
        selectedClipId: nextSelectedClipId,
        playhead: parsedProject.state.playhead,
        pixelsPerSecond: parsedProject.state.pixelsPerSecond,
      });

      const fallbackName = `untitled${PROJECT_FILE_EXTENSION}`;
      const nextPath = sourcePathOrName && sourcePathOrName.trim() ? sourcePathOrName : null;
      const nextFileName = getFileNameFromPath(nextPath ?? fallbackName);

      setProjectFilePath(nextPath);
      setProjectFileName(nextFileName);

      return nextFileName;
    },
    [mediaLoadErrors, replaceProjectState, t],
  );

  const handleProjectFileSelection = useCallback(
    async (event: ReactChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!file) return;

      setIsProjectBusy(true);
      setStatusMessage(null);

      try {
        const content = await file.text();
        const loadedName = await loadProjectContent(content, file.name);
        setStatusMessage(t("project.notice.loaded", { name: loadedName }));
      } catch (error) {
        console.error("[project] Failed to load project file.", error);
        setStatusMessage(error instanceof Error ? error.message : t("project.notice.openError"));
      } finally {
        setIsProjectBusy(false);
      }
    },
    [loadProjectContent, t],
  );

  const handleOpenProject = useCallback(async () => {
    setStatusMessage(null);

    if (!window.nebulacut?.project) {
      projectInputRef.current?.click();
      return;
    }

    setIsProjectBusy(true);
    try {
      const result = await window.nebulacut.project.open();
      if (result.canceled) return;

      const loadedName = await loadProjectContent(result.content, result.filePath);
      setStatusMessage(t("project.notice.loaded", { name: loadedName }));
    } catch (error) {
      console.error("[project] Failed to open project.", error);
      setStatusMessage(error instanceof Error ? error.message : t("project.notice.openError"));
    } finally {
      setIsProjectBusy(false);
    }
  }, [loadProjectContent, t]);

  const handleSaveProject = useCallback(async () => {
    setIsProjectBusy(true);
    setStatusMessage(null);

    try {
      const serializedAssets: SerializedMediaAsset[] = [];
      for (const asset of assets) {
        serializedAssets.push({
          id: asset.id,
          type: asset.type,
          name: asset.name,
          mimeType: asset.file.type,
          dataUrl: await fileToDataUrl(asset.file),
          sourcePath: asset.sourcePath,
          hasAudioTrack: asset.hasAudioTrack,
        });
      }

      const projectPayload: NebulaCutProjectFile = {
        kind: PROJECT_FILE_KIND,
        version: PROJECT_FILE_VERSION,
        savedAt: new Date().toISOString(),
        state: {
          assets: serializedAssets,
          tracks,
          clips,
          selectedClipId,
          playhead,
          pixelsPerSecond,
        },
      };

      const content = JSON.stringify(projectPayload, null, 2);
      const suggestedPath =
        (projectFilePath && projectFilePath.trim()) ||
        (projectFileName && projectFileName.trim()) ||
        `untitled${PROJECT_FILE_EXTENSION}`;

      if (window.nebulacut?.project) {
        const result = await window.nebulacut.project.save(content, suggestedPath);
        if (result.canceled) return;

        const savedName = getFileNameFromPath(result.filePath);
        setProjectFilePath(result.filePath);
        setProjectFileName(savedName);
        setStatusMessage(t("project.notice.saved", { name: savedName }));
        return;
      }

      const downloadName = withProjectExtension(
        projectFileName && projectFileName.trim()
          ? projectFileName
          : `untitled${PROJECT_FILE_EXTENSION}`,
      );
      const blob = new Blob([content], { type: "application/json" });
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = downloadName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);

      setProjectFilePath(null);
      setProjectFileName(downloadName);
      setStatusMessage(t("project.notice.saved", { name: downloadName }));
    } catch (error) {
      console.error("[project] Failed to save project.", error);
      setStatusMessage(t("project.notice.saveError"));
    } finally {
      setIsProjectBusy(false);
    }
  }, [
    assets,
    clips,
    pixelsPerSecond,
    playhead,
    projectFileName,
    projectFilePath,
    selectedClipId,
    t,
    tracks,
  ]);

  const handleOpenYouTubeDialog = useCallback(() => {
    setIsMediaImportMenuOpen(false);
    setYoutubeUrlInput("");
    setYoutubeDialogNotice(null);
    setIsYouTubeDialogOpen(true);
  }, []);

  const handleDownloadFromYouTube = useCallback(async () => {
    const normalizedUrl = youtubeUrlInput.trim();
    if (!normalizedUrl) {
      const notice = t("youtube.notice.emptyUrl");
      setYoutubeDialogNotice(notice);
      setStatusMessage(notice);
      return;
    }

    if (!window.nebulacut?.media) {
      const notice = t("youtube.notice.electronOnly");
      setYoutubeDialogNotice(notice);
      setStatusMessage(notice);
      return;
    }

    setYoutubeDialogNotice(null);
    setStatusMessage(null);
    setIsDownloadingYouTube(true);

    const setYouTubeFailureNotice = (
      reason:
        | "INVALID_URL"
        | "YTDLP_NOT_FOUND"
        | "DOWNLOAD_FAILED"
        | "FILE_READ_FAILED"
        | "UNSUPPORTED_MEDIA_TYPE",
    ) => {
      if (reason === "INVALID_URL") {
        const notice = t("youtube.notice.invalidUrl");
        setYoutubeDialogNotice(notice);
        setStatusMessage(notice);
        return;
      }
      if (reason === "YTDLP_NOT_FOUND") {
        const notice = t("youtube.notice.toolMissing");
        setYoutubeDialogNotice(notice);
        setStatusMessage(notice);
        return;
      }
      if (reason === "FILE_READ_FAILED") {
        const notice = t("youtube.notice.readFailed");
        setYoutubeDialogNotice(notice);
        setStatusMessage(notice);
        return;
      }
      if (reason === "UNSUPPORTED_MEDIA_TYPE") {
        const notice = t("youtube.notice.unsupportedType");
        setYoutubeDialogNotice(notice);
        setStatusMessage(notice);
        return;
      }

      const notice = t("youtube.notice.downloadFailed");
      setYoutubeDialogNotice(notice);
      setStatusMessage(notice);
    };

    const importDownloadedMedia = async (downloadedMedia: {
      filePath: string;
      fileName: string;
      mimeType: string;
      mediaType: "video" | "audio";
      base64Data: string;
    }) => {
      const file = base64ToFile(downloadedMedia.base64Data, downloadedMedia.fileName, downloadedMedia.mimeType);
      const asset = await loadMediaAsset(file, downloadedMedia.mediaType, mediaLoadErrors);
      setAssets((prev) => [
        ...prev,
        { ...asset, name: downloadedMedia.fileName, sourcePath: downloadedMedia.filePath },
      ]);
      setIsYouTubeDialogOpen(false);
      setYoutubeUrlInput("");
      setYoutubeDialogNotice(null);
      setStatusMessage(t("youtube.notice.success", { name: downloadedMedia.fileName }));
    };

    const isWebMDownload = (downloadedMedia: { fileName: string; mimeType: string }) => {
      const lowerMimeType = downloadedMedia.mimeType.toLowerCase();
      const lowerFileName = downloadedMedia.fileName.toLowerCase();
      return lowerMimeType.includes("webm") || lowerFileName.endsWith(".webm");
    };

    try {
      const initialResult = await window.nebulacut.media.downloadYouTube(normalizedUrl);
      if (!initialResult.success) {
        setYouTubeFailureNotice(initialResult.reason);
        return;
      }

      try {
        await importDownloadedMedia(initialResult);
      } catch (error) {
        console.warn(
          "[media] Retrying YouTube import with WebM preference after metadata load failure.",
          {
            error,
            fileName: initialResult.fileName,
            mimeType: initialResult.mimeType,
            mediaType: initialResult.mediaType,
          },
        );

        const retryResult = await window.nebulacut.media.downloadYouTube(normalizedUrl, {
          preferWebM: true,
        });
        if (!retryResult.success) {
          setYouTubeFailureNotice(retryResult.reason);
          return;
        }

        try {
          await importDownloadedMedia(retryResult);
        } catch (retryError) {
          console.error("[media] Failed to import YouTube media after WebM retry.", {
            retryError,
            fileName: retryResult.fileName,
            mimeType: retryResult.mimeType,
            mediaType: retryResult.mediaType,
          });

          if (!isWebMDownload(retryResult)) {
            const notice = t("youtube.notice.retryNeedsRestart");
            setYoutubeDialogNotice(notice);
            setStatusMessage(notice);
            return;
          }

          throw retryError;
        }
      }
    } catch (error) {
      console.error("[media] Failed to import YouTube media.", error);
      const notice = t("youtube.notice.downloadFailed");
      setYoutubeDialogNotice(notice);
      setStatusMessage(notice);
    } finally {
      setIsDownloadingYouTube(false);
    }
  }, [mediaLoadErrors, t, youtubeUrlInput]);

  const handleOpenMediaImportPicker = useCallback((type: MediaType) => {
    setIsMediaImportMenuOpen(false);

    if (type === "video") {
      videoInputRef.current?.click();
      return;
    }
    if (type === "image") {
      imageInputRef.current?.click();
      return;
    }
    audioInputRef.current?.click();
  }, []);

  useEffect(() => {
    if (!isMediaImportMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (mediaImportMenuRef.current?.contains(target)) return;
      setIsMediaImportMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMediaImportMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMediaImportMenuOpen]);

  useEffect(() => {
    if (!isYouTubeDialogOpen || isDownloadingYouTube) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsYouTubeDialogOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDownloadingYouTube, isYouTubeDialogOpen]);

  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  const trackOrder = useMemo(() => {
    const order = new Map<string, number>();
    tracks.forEach((track, index) => {
      order.set(track.id, index);
    });
    return order;
  }, [tracks]);

  const timelineDuration = useMemo(() => {
    const maxClip = clips.reduce((acc, clip) => Math.max(acc, clip.start + clip.duration), 0);
    return Math.max(EMPTY_TIMELINE_DURATION, maxClip);
  }, [clips]);

  const timelineZoomRange = useMemo(() => getTimelineZoomRange(clips), [clips]);

  const timelineWidth = timelineDuration * pixelsPerSecond;
  const effectivePlayhead = Math.min(playhead, timelineDuration);

  useEffect(() => {
    setPixelsPerSecond((previousZoom) =>
      clamp(previousZoom, timelineZoomRange.min, timelineZoomRange.max),
    );
  }, [timelineZoomRange.max, timelineZoomRange.min]);

  const selectedClip = useMemo(
    () => clips.find((clip) => clip.id === selectedClipId) ?? null,
    [clips, selectedClipId],
  );

  const selectedTrack = useMemo(() => {
    if (!selectedClip) return null;
    return tracks.find((track) => track.id === selectedClip.trackId) ?? null;
  }, [selectedClip, tracks]);

  const selectedAsset = useMemo(() => {
    if (!selectedClip) return null;
    return assetMap.get(selectedClip.assetId) ?? null;
  }, [assetMap, selectedClip]);

  const activeVisualClip = useMemo(() => {
    const active = clips
      .filter((clip) => {
        const track = tracks.find((item) => item.id === clip.trackId);
        return (
          track?.type === "video" &&
          effectivePlayhead >= clip.start &&
          effectivePlayhead < clip.start + clip.duration
        );
      })
      .sort((a, b) => (trackOrder.get(a.trackId) ?? 0) - (trackOrder.get(b.trackId) ?? 0));

    return active.length ? active[active.length - 1] : null;
  }, [clips, effectivePlayhead, trackOrder, tracks]);

  const activeVisualAsset = useMemo(() => {
    if (!activeVisualClip) return null;
    return assetMap.get(activeVisualClip.assetId) ?? null;
  }, [activeVisualClip, assetMap]);

  const activeAudioClips = useMemo(() => {
    return clips.filter((clip) => {
      const track = tracks.find((item) => item.id === clip.trackId);
      const asset = assetMap.get(clip.assetId);
      const hasPlayableAudio =
        asset?.type === "audio" ||
        (asset?.type === "video" && asset.hasAudioTrack === true);

      return (
        track?.type === "audio" &&
        hasPlayableAudio &&
        effectivePlayhead >= clip.start &&
        effectivePlayhead < clip.start + clip.duration
      );
    });
  }, [assetMap, clips, effectivePlayhead, tracks]);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    const audioElements = audioElementsRef.current;

    return () => {
      assetsRef.current.forEach((asset) => URL.revokeObjectURL(asset.url));
      audioElements.forEach((audio) => audio.pause());
      audioElements.clear();
    };
  }, []);

  useEffect(() => {
    if (!isPlaying) return;

    let rafId = 0;
    let lastTime = performance.now();

    const step = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      setPlayhead((prev) => {
        const next = prev + delta;
        if (next >= timelineDuration) {
          setIsPlaying(false);
          return timelineDuration;
        }
        return next;
      });

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);

    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, timelineDuration]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      if (pendingVideoSeekRef.current !== null) {
        video.currentTime = pendingVideoSeekRef.current;
        pendingVideoSeekRef.current = null;
        if (isPlaying) {
          video.play().catch(() => undefined);
        }
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    return () => video.removeEventListener("loadedmetadata", handleLoadedMetadata);
  }, [isPlaying]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!activeVisualClip || !activeVisualAsset || activeVisualAsset.type !== "video") {
      activeVideoClipRef.current = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
      return;
    }

    const targetTime =
      activeVisualClip.offset + (effectivePlayhead - activeVisualClip.start);

    if (activeVideoClipRef.current !== activeVisualClip.id) {
      activeVideoClipRef.current = activeVisualClip.id;
      pendingVideoSeekRef.current = targetTime;
      video.src = activeVisualAsset.url;
      video.load();
    } else if (Math.abs(video.currentTime - targetTime) > 0.25) {
      video.currentTime = targetTime;
    }

    if (isPlaying) {
      video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [activeVisualAsset, activeVisualClip, effectivePlayhead, isPlaying]);

  useEffect(() => {
    const activeIds = new Set(activeAudioClips.map((clip) => clip.id));

    audioElementsRef.current.forEach((audio, clipId) => {
      if (!activeIds.has(clipId) || !isPlaying) {
        audio.pause();
      }
    });

    activeAudioClips.forEach((clip) => {
      const asset = assetMap.get(clip.assetId);
      if (!asset || asset.type !== "audio") return;

      let audio = audioElementsRef.current.get(clip.id);
      if (!audio) {
        audio = new Audio(asset.url);
        audio.preload = "auto";
        audioElementsRef.current.set(clip.id, audio);
      }

      const targetTime = clip.offset + (effectivePlayhead - clip.start);
      if (Math.abs(audio.currentTime - targetTime) > 0.3) {
        audio.currentTime = Math.max(0, targetTime);
      }

      audio.volume = clip.gain;
      if (isPlaying) {
        audio.play().catch(() => undefined);
      } else {
        audio.pause();
      }
    });
  }, [activeAudioClips, assetMap, effectivePlayhead, isPlaying]);

  const createTrack = useCallback(
    (type: TrackType) => {
      const count = tracks.filter((track) => track.type === type).length + 1;
      return {
        id: generateId(),
        name: `${type === "video" ? "V" : "A"}${count}`,
        type,
      };
    },
    [tracks],
  );

  const ensureTrack = useCallback(
    (type: TrackType) => {
      let track = tracks.find((item) => item.type === type) ?? null;
      if (!track) {
        const created = createTrack(type);
        setTracks((prev) => [...prev, created]);
        track = created;
      }
      return track;
    },
    [createTrack, tracks],
  );

  const handleImport = useCallback(async (files: FileList | null, type: MediaType) => {
    if (!files || files.length === 0) return;

    setStatusMessage(null);

    try {
      const loaded: MediaAsset[] = [];
      for (const file of Array.from(files)) {
        const asset = await loadMediaAsset(file, type, mediaLoadErrors);
        loaded.push({ ...asset, sourcePath: getFilePathFromFile(file) ?? undefined });
      }
      setAssets((prev) => [...prev, ...loaded]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : t("errors.fileLoad"));
    }
  }, [mediaLoadErrors, t]);

  const handleOpenAssetSourceFolder = useCallback(
    async (asset: MediaAsset) => {
      const sourcePath = asset.sourcePath?.trim();
      if (!sourcePath) {
        setStatusMessage(t("media.notice.sourcePathUnavailable"));
        return;
      }

      if (!window.nebulacut?.media?.showInFolder) {
        setStatusMessage(t("media.notice.openFolderElectronOnly"));
        return;
      }

      try {
        const result = await window.nebulacut.media.showInFolder(sourcePath);
        if (result.success) {
          setStatusMessage(null);
          return;
        }

        if (result.reason === "INVALID_PATH") {
          setStatusMessage(t("media.notice.sourcePathUnavailable"));
          return;
        }

        setStatusMessage(t("media.notice.openFolderFailed"));
      } catch (error) {
        console.error("[media] Failed to open source folder.", error);
        setStatusMessage(t("media.notice.openFolderFailed"));
      }
    },
    [t],
  );

  const handleAddClip = useCallback(
    (asset: MediaAsset, targetTrackType: TrackType) => {
      if (targetTrackType === "video" && asset.type === "audio") {
        setStatusMessage(t("errors.audioToVideoForbidden"));
        return;
      }

      if (
        targetTrackType === "audio" &&
        asset.type !== "audio" &&
        !(asset.type === "video" && asset.hasAudioTrack)
      ) {
        setStatusMessage(t("errors.onlyAudioOnAudioTrack"));
        return;
      }

      const track = ensureTrack(targetTrackType);
      if (!track) return;

      const trackClips = clips.filter((clip) => clip.trackId === track.id);
      const trackEnd = trackClips.reduce(
        (acc, clip) => Math.max(acc, clip.start + clip.duration),
        0,
      );

      const baseDuration =
        asset.type === "image" ? DEFAULT_IMAGE_DURATION : Math.max(asset.duration || 1, 1);

      const nextClip: Clip = {
        id: generateId(),
        trackId: track.id,
        assetId: asset.id,
        start: trackEnd,
        offset: 0,
        duration: Math.max(baseDuration, MIN_CLIP_DURATION),
        gain: 1,
      };

      let companionAudioClip: Clip | null = null;
      if (targetTrackType === "video" && asset.type === "video" && asset.hasAudioTrack) {
        const audioTrack = ensureTrack("audio");
        if (audioTrack) {
          companionAudioClip = {
            id: generateId(),
            trackId: audioTrack.id,
            assetId: asset.id,
            start: nextClip.start,
            offset: nextClip.offset,
            duration: nextClip.duration,
            gain: 1,
          };
        }
      }

      setClips((prev) =>
        companionAudioClip ? [...prev, nextClip, companionAudioClip] : [...prev, nextClip],
      );
      setSelectedClipId(nextClip.id);
      setStatusMessage(null);
    },
    [clips, ensureTrack, t],
  );

  const handleDeleteClip = useCallback(() => {
    if (!selectedClipId) return;
    setClips((prev) => prev.filter((clip) => clip.id !== selectedClipId));
    setSelectedClipId(null);
  }, [selectedClipId]);

  const handleSplitClip = useCallback(() => {
    if (!selectedClip) return;

    const splitPoint = effectivePlayhead;
    if (
      splitPoint <= selectedClip.start + MIN_CLIP_DURATION ||
      splitPoint >= selectedClip.start + selectedClip.duration - MIN_CLIP_DURATION
    ) {
      setStatusMessage(t("errors.splitTooClose"));
      return;
    }

    const firstDuration = splitPoint - selectedClip.start;
    const secondDuration = selectedClip.duration - firstDuration;
    const asset = assetMap.get(selectedClip.assetId);

    const secondClip: Clip = {
      ...selectedClip,
      id: generateId(),
      start: splitPoint,
      offset:
        asset?.type === "image"
          ? selectedClip.offset
          : selectedClip.offset + firstDuration,
      duration: secondDuration,
    };

    setClips((prev) =>
      prev
        .map((clip) =>
          clip.id === selectedClip.id ? { ...clip, duration: firstDuration } : clip,
        )
        .concat(secondClip),
    );

    setSelectedClipId(secondClip.id);
    setStatusMessage(null);
  }, [assetMap, effectivePlayhead, selectedClip, t]);

  const handleUpdateClip = useCallback((clipId: string, patch: Partial<Clip>) => {
    setClips((prev) =>
      prev.map((clip) => {
        if (clip.id !== clipId) return clip;
        return { ...clip, ...patch };
      }),
    );
  }, []);

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, clip: Clip, mode: DragMode) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedClipId(clip.id);

      dragStateRef.current = {
        clipId: clip.id,
        mode,
        startX: event.clientX,
        startStart: clip.start,
        startOffset: clip.offset,
        startDuration: clip.duration,
      };
    },
    [],
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;

      const clip = clips.find((item) => item.id === dragState.clipId);
      if (!clip) return;

      const asset = assetMap.get(clip.assetId);
      const isImageClip = asset?.type === "image";
      const assetDuration = isImageClip
        ? Number.POSITIVE_INFINITY
        : asset?.duration ?? clip.offset + clip.duration;
      const delta = (event.clientX - dragState.startX) / pixelsPerSecond;

      if (dragState.mode === "move") {
        const nextStart = Math.max(0, dragState.startStart + delta);
        handleUpdateClip(clip.id, { start: nextStart });
        return;
      }

      if (dragState.mode === "trim-start") {
        const minDelta = isImageClip
          ? -dragState.startStart
          : Math.max(-dragState.startStart, -dragState.startOffset);
        const maxDelta = Math.min(
          dragState.startDuration - MIN_CLIP_DURATION,
          assetDuration - MIN_CLIP_DURATION - dragState.startOffset,
        );
        const applied = clamp(delta, minDelta, maxDelta);

        handleUpdateClip(clip.id, {
          start: dragState.startStart + applied,
          offset: isImageClip
            ? dragState.startOffset
            : dragState.startOffset + applied,
          duration: dragState.startDuration - applied,
        });

        return;
      }

      if (dragState.mode === "trim-end") {
        const minDelta = MIN_CLIP_DURATION - dragState.startDuration;
        const maxDelta = isImageClip
          ? 3600 - dragState.startDuration
          : assetDuration - dragState.startOffset - dragState.startDuration;
        const applied = clamp(delta, minDelta, maxDelta);

        handleUpdateClip(clip.id, {
          duration: dragState.startDuration + applied,
        });
      }
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [assetMap, clips, handleUpdateClip, pixelsPerSecond]);

  const updatePlayheadFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const rect = timelineInnerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = event.clientX - rect.left;
      const nextTime = clamp(x / pixelsPerSecond, 0, timelineDuration);
      setPlayhead(nextTime);
    },
    [pixelsPerSecond, timelineDuration],
  );

  const handleTimelinePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      updatePlayheadFromPointer(event);
      scrubPointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [updatePlayheadFromPointer],
  );

  const handleTimelinePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (scrubPointerIdRef.current !== event.pointerId) return;
      updatePlayheadFromPointer(event);
    },
    [updatePlayheadFromPointer],
  );

  const handleTimelinePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubPointerIdRef.current !== event.pointerId) return;
    scrubPointerIdRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const rulerLabels = useMemo(() => {
    const labels: Array<{ time: number; label: string }> = [];
    const step = timelineDuration > 90 ? 10 : timelineDuration > 40 ? 5 : 1;

    for (let time = 0; time <= timelineDuration; time += step) {
      labels.push({
        time,
        label: `${formatNumber(time)}${t("timeline.secondSuffix")}`,
      });
    }

    return labels;
  }, [formatNumber, t, timelineDuration]);

  return (
    <div className="h-full bg-slate-950 text-slate-100">
      <div className="flex h-full flex-col">
        <header className="border-b border-white/10 bg-slate-900/90 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold tracking-wide text-cyan-300">{t("app.title")}</p>
              <p className="text-xs text-slate-400">{t("app.subtitle")}</p>
              <p className="text-[11px] text-slate-500">
                {t("project.current", { name: projectDisplayName })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-slate-300">
                <span>{t("language.label")}</span>
                <select
                  className="rounded border border-white/20 bg-slate-900/90 px-1 py-0.5 text-xs text-slate-100"
                  value={localePreference}
                  onChange={(event) =>
                    setLocalePreference(event.target.value as LocalePreference)
                  }
                >
                  <option value="system">
                    {t("language.system")} ({systemLocale.toUpperCase()})
                  </option>
                  <option value="en">{t("language.english")}</option>
                  <option value="ko">{t("language.korean")}</option>
                </select>
              </label>
              <button
                className="inline-flex items-center gap-1 rounded-md border border-violet-300/40 bg-violet-400/10 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void handleOpenProject()}
                disabled={isProjectBusy}
              >
                {t("header.openProject")}
              </button>
              <button
                className="inline-flex items-center gap-1 rounded-md border border-teal-300/40 bg-teal-400/10 px-3 py-1.5 text-xs font-semibold text-teal-100 hover:bg-teal-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void handleSaveProject()}
                disabled={isProjectBusy}
              >
                {t("header.saveProject")}
              </button>
              <button
                className="inline-flex items-center gap-1 rounded-md border border-emerald-300/40 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/20"
                onClick={() => setIsSettingsOpen(true)}
              >
                <HiOutlineCog6Tooth className="text-sm" />
                {t("header.settings")}
              </button>
            </div>
          </div>
        </header>

        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          multiple
          hidden
          onChange={(event) => {
            void handleImport(event.target.files, "video");
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            void handleImport(event.target.files, "image");
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={(event) => {
            void handleImport(event.target.files, "audio");
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={projectInputRef}
          type="file"
          accept=".nbcut,.json,application/json"
          hidden
          onChange={(event) => {
            void handleProjectFileSelection(event);
          }}
        />

        {isYouTubeDialogOpen && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4"
            onClick={() => {
              if (!isDownloadingYouTube) {
                setIsYouTubeDialogOpen(false);
                setYoutubeDialogNotice(null);
              }
            }}
          >
            <div
              className="w-full max-w-lg rounded-xl border border-white/10 bg-slate-900 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="border-b border-white/10 px-4 py-3">
                <h2 className="text-sm font-semibold text-cyan-200">{t("youtube.dialog.title")}</h2>
                <p className="mt-1 text-xs text-slate-400">{t("youtube.dialog.description")}</p>
              </div>

              <form
                className="space-y-3 px-4 py-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleDownloadFromYouTube();
                }}
              >
                <label className="block text-xs text-slate-300">
                  <span className="font-medium text-slate-100">{t("youtube.inputLabel")}</span>
                  <input
                    className="mt-1 w-full rounded-md border border-white/15 bg-slate-950/80 px-2 py-1.5 text-sm text-slate-100"
                    type="url"
                    required
                    autoFocus
                    value={youtubeUrlInput}
                    placeholder={t("youtube.inputPlaceholder")}
                    onChange={(event) => {
                      setYoutubeUrlInput(event.target.value);
                      setYoutubeDialogNotice(null);
                    }}
                  />
                </label>

                {youtubeDialogNotice && (
                  <div className="rounded border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                    {youtubeDialogNotice}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-3">
                  <button
                    type="button"
                    className="rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-slate-100 hover:bg-white/10"
                    onClick={() => {
                      setIsYouTubeDialogOpen(false);
                      setYoutubeDialogNotice(null);
                    }}
                    disabled={isDownloadingYouTube}
                  >
                    {t("youtube.cancel")}
                  </button>
                  <button
                    type="submit"
                    className="rounded-md border border-cyan-300/40 bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isDownloadingYouTube}
                  >
                    {isDownloadingYouTube ? t("youtube.downloading") : t("youtube.download")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {isSettingsOpen && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4">
            <div className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-2xl">
              <div className="flex items-start justify-between border-b border-white/10 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-emerald-200">{t("header.settings")}</h2>
                  <p className="mt-1 text-xs text-slate-400">{t("settings.description")}</p>
                </div>
                <button
                  className="rounded-md border border-white/20 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10"
                  onClick={() => setIsSettingsOpen(false)}
                >
                  {t("settings.close")}
                </button>
              </div>

              <div className="grid max-h-[70vh] min-h-[62vh] grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
                <aside className="border-b border-white/10 bg-slate-950/50 p-3 md:border-b-0 md:border-r">
                  <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {t("settings.menu")}
                  </p>
                  <div className="space-y-1">
                    <button
                      className={`w-full rounded-md px-2 py-2 text-left text-xs ${
                        activeSettingsTab === "general"
                          ? "border border-white/20 bg-white/10 text-white"
                          : "border border-transparent bg-transparent text-slate-300 hover:bg-white/5"
                      }`}
                      onClick={() => setActiveSettingsTab("general")}
                    >
                      {t("settings.tab.general")}
                    </button>
                    <button
                      className={`w-full rounded-md px-2 py-2 text-left text-xs ${
                        activeSettingsTab === "aiProviders"
                          ? "border border-emerald-300/30 bg-emerald-500/15 text-emerald-100"
                          : "border border-transparent bg-transparent text-slate-300 hover:bg-white/5"
                      }`}
                      onClick={() => setActiveSettingsTab("aiProviders")}
                    >
                      {t("settings.tab.aiProviders")}
                    </button>
                  </div>
                </aside>

                <main className="min-h-0 overflow-y-auto px-4 py-3">
                  {activeSettingsTab === "general" ? (
                    <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/40 p-4">
                      <h3 className="text-sm font-semibold text-white">{t("settings.general.title")}</h3>
                      <p className="mt-1 text-xs text-slate-400">{t("settings.general.empty")}</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-emerald-100">
                          {t("settings.tab.aiProviders")}
                        </h3>
                        <p className="mt-1 text-xs text-slate-400">{t("settings.subtitle")}</p>
                      </div>
                      <p className="text-xs text-slate-400">{t("settings.helper")}</p>

                      {apiKeysNoticeMessage && (
                        <div
                          className={`rounded border px-3 py-2 text-xs ${
                            apiKeysNotice === "saved"
                              ? "border-emerald-300/30 bg-emerald-500/10 text-emerald-100"
                              : "border-amber-300/30 bg-amber-500/10 text-amber-100"
                          }`}
                        >
                          {apiKeysNoticeMessage}
                        </div>
                      )}

                      {isLoadingApiKeys ? (
                        <div className="rounded border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
                          {t("settings.loading")}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {API_KEY_FIELD_ORDER.map((field) => (
                            <label key={field} className="block text-xs text-slate-300">
                              <span className="font-medium text-slate-100">
                                {t("settings.variableLabel", { name: field })}
                              </span>
                              <input
                                className="mt-1 w-full rounded-md border border-white/15 bg-slate-950/80 px-2 py-1.5 font-mono text-sm text-slate-100"
                                type="password"
                                autoComplete="off"
                                spellCheck={false}
                                value={apiKeys[field]}
                                placeholder={t("settings.inputPlaceholder")}
                                onChange={(event) => {
                                  const nextValue = event.target.value;
                                  setApiKeys((prev) => ({ ...prev, [field]: nextValue }));
                                  setApiKeysNotice(null);
                                }}
                              />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </main>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
                <p className="text-[11px] text-slate-500">
                  {activeSettingsTab === "aiProviders"
                    ? isElectronRuntime
                      ? t("settings.storage.electron")
                      : t("settings.storage.browser")
                    : t("settings.general.footer")}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-slate-100 hover:bg-white/10"
                    onClick={() => setIsSettingsOpen(false)}
                  >
                    {t("settings.close")}
                  </button>
                  <button
                    className="rounded-md border border-emerald-300/40 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void handleSaveApiKeys()}
                    disabled={activeSettingsTab !== "aiProviders" || isLoadingApiKeys || isSavingApiKeys}
                  >
                    {isSavingApiKeys ? t("settings.saving") : t("settings.save")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <section className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-white/5 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
          <aside className="min-h-0 overflow-y-auto bg-slate-900/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                {t("media.library")}
              </h2>
              <div ref={mediaImportMenuRef} className="relative">
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-cyan-300/40 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/20"
                  onClick={() => setIsMediaImportMenuOpen((prev) => !prev)}
                >
                  <HiOutlinePlus
                    className={`text-base transition-transform ${
                      isMediaImportMenuOpen ? "rotate-45" : ""
                    }`}
                  />
                </button>

                {isMediaImportMenuOpen && (
                  <div className="absolute right-0 z-30 mt-2 w-40 rounded-md border border-white/15 bg-slate-950/95 p-1 shadow-xl">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-white/10"
                      onClick={() => handleOpenMediaImportPicker("video")}
                    >
                      <HiOutlineVideoCamera className="text-sm text-cyan-200" />
                      {t("header.addVideo")}
                    </button>
                    <button
                      type="button"
                      className="mt-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-white/10"
                      onClick={() => handleOpenMediaImportPicker("image")}
                    >
                      <HiOutlinePhoto className="text-sm text-amber-200" />
                      {t("header.addImage")}
                    </button>
                    <button
                      type="button"
                      className="mt-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-white/10"
                      onClick={() => handleOpenMediaImportPicker("audio")}
                    >
                      <HiOutlineMusicalNote className="text-sm text-indigo-200" />
                      {t("header.addAudio")}
                    </button>
                    <button
                      type="button"
                      className="mt-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-white/10"
                      onClick={handleOpenYouTubeDialog}
                    >
                      <HiOutlineVideoCamera className="text-sm text-rose-200" />
                      {t("media.addFromYouTube")}
                    </button>
                  </div>
                )}
              </div>
            </div>
            {assets.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/40 p-3 text-xs text-slate-400">
                {t("media.empty")}
              </div>
            ) : (
              <div className="space-y-2">
                {assets.map((asset) => {
                  const canToVideo = asset.type === "video" || asset.type === "image";
                  const canToAudio = asset.type === "audio";

                  return (
                    <div
                      key={asset.id}
                      className="rounded-lg border border-white/10 bg-slate-950/60 p-3"
                    >
                      <p className="truncate text-sm font-medium text-white">{asset.name}</p>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                        <span>{getAssetTypeLabel(asset.type)}</span>
                        <span>{formatTimeLabel(asset.duration)}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {canToVideo && (
                          <button
                            className="rounded border border-cyan-300/40 bg-cyan-400/10 px-2 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-400/20"
                            onClick={() => handleAddClip(asset, "video")}
                          >
                            {t("media.toVideoTrack")}
                          </button>
                        )}
                        {canToAudio && (
                          <button
                            className="rounded border border-indigo-300/40 bg-indigo-400/10 px-2 py-1 text-[11px] font-semibold text-indigo-100 hover:bg-indigo-400/20"
                            onClick={() => handleAddClip(asset, "audio")}
                          >
                            {t("media.toAudioTrack")}
                          </button>
                        )}
                        {isElectronRuntime && (
                          <button
                            className="rounded border border-white/20 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => void handleOpenAssetSourceFolder(asset)}
                            disabled={!asset.sourcePath?.trim()}
                          >
                            {t("media.openSourceFolder")}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </aside>

          <main className="min-h-0 overflow-y-auto bg-slate-950/40 p-4">
            <div className="rounded-xl border border-white/10 bg-slate-900/80 p-3">
              <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  className={`h-full w-full object-contain ${
                    activeVisualAsset?.type === "video" ? "block" : "hidden"
                  }`}
                />
                {activeVisualAsset?.type === "image" && (
                  <img
                    src={activeVisualAsset.url}
                    alt={activeVisualAsset.name}
                    className="h-full w-full object-contain"
                  />
                )}
                {!activeVisualClip && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
                    {t("preview.empty")}
                  </div>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="inline-flex items-center gap-1 rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
                    onClick={() => setIsPlaying((prev) => !prev)}
                  >
                    {isPlaying ? <HiOutlinePause /> : <HiOutlinePlay />}
                    {isPlaying ? t("controls.pause") : t("controls.play")}
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
                    onClick={handleSplitClip}
                  >
                    <HiOutlineScissors />
                    {t("controls.split")}
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded-md border border-rose-300/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/20"
                    onClick={handleDeleteClip}
                  >
                    <HiOutlineTrash />
                    {t("controls.delete")}
                  </button>
                </div>
                <div className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300">
                  {t("controls.playhead", { time: formatTimeLabel(effectivePlayhead) })}
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-white/10 bg-slate-900/60 p-3">
                <p className="text-slate-400">{t("stats.timelineDuration")}</p>
                <p className="mt-1 font-semibold text-white">
                  {formatTimeLabel(timelineDuration)}
                </p>
              </div>
              <div className="rounded border border-white/10 bg-slate-900/60 p-3">
                <p className="text-slate-400">{t("stats.clipCount")}</p>
                <p className="mt-1 font-semibold text-white">{formatNumber(clips.length)}</p>
              </div>
            </div>

            {statusMessage && (
              <div className="mt-3 rounded border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {statusMessage}
              </div>
            )}
          </main>

          <aside className="min-h-0 overflow-y-auto bg-slate-900/60 p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("inspector.title")}
            </h2>

            {selectedClip ? (
              <div className="space-y-3">
                <div className="rounded border border-white/10 bg-slate-950/60 p-3 text-xs text-slate-300">
                  <p>{t("inspector.clipId", { id: selectedClip.id.slice(0, 8) })}</p>
                  <p className="mt-1">
                    {t("inspector.type", {
                      type: selectedAsset ? getAssetTypeLabel(selectedAsset.type) : "-",
                    })}
                  </p>
                </div>

                <label className="block text-xs text-slate-300">
                  {t("inspector.startSeconds")}
                  <input
                    className="mt-1 w-full rounded-md border border-white/15 bg-slate-950/80 px-2 py-1.5 text-sm"
                    type="number"
                    step="0.1"
                    value={selectedClip.start.toFixed(2)}
                    onChange={(event) => {
                      const next = Math.max(0, Number(event.target.value));
                      handleUpdateClip(selectedClip.id, { start: next });
                    }}
                  />
                </label>

                <label className="block text-xs text-slate-300">
                  {t("inspector.durationSeconds")}
                  <input
                    className="mt-1 w-full rounded-md border border-white/15 bg-slate-950/80 px-2 py-1.5 text-sm"
                    type="number"
                    step="0.1"
                    value={selectedClip.duration.toFixed(2)}
                    onChange={(event) => {
                      const next = Math.max(MIN_CLIP_DURATION, Number(event.target.value));
                      if (selectedAsset?.type === "image") {
                        handleUpdateClip(selectedClip.id, { duration: next });
                        return;
                      }

                      const maxDuration = selectedAsset
                        ? Math.max(
                            MIN_CLIP_DURATION,
                            selectedAsset.duration - selectedClip.offset,
                          )
                        : next;

                      handleUpdateClip(selectedClip.id, {
                        duration: Math.min(next, maxDuration),
                      });
                    }}
                  />
                </label>

                {selectedAsset?.type !== "image" && (
                  <label className="block text-xs text-slate-300">
                    {t("inspector.offsetSeconds")}
                    <input
                      className="mt-1 w-full rounded-md border border-white/15 bg-slate-950/80 px-2 py-1.5 text-sm"
                      type="number"
                      step="0.1"
                      value={selectedClip.offset.toFixed(2)}
                      onChange={(event) => {
                        const next = Math.max(0, Number(event.target.value));
                        const maxOffset = selectedAsset
                          ? Math.max(0, selectedAsset.duration - selectedClip.duration)
                          : next;

                        handleUpdateClip(selectedClip.id, {
                          offset: Math.min(next, maxOffset),
                        });
                      }}
                    />
                  </label>
                )}

                {selectedTrack?.type === "audio" && (
                  <label className="block text-xs text-slate-300">
                    {t("inspector.volume")}
                    <input
                      className="mt-1 w-full rounded-md border border-white/15 bg-slate-950/80 px-2 py-1.5 text-sm"
                      type="number"
                      step="0.05"
                      min="0"
                      max="1.5"
                      value={selectedClip.gain.toFixed(2)}
                      onChange={(event) => {
                        handleUpdateClip(selectedClip.id, {
                          gain: clamp(Number(event.target.value), 0, 1.5),
                        });
                      }}
                    />
                  </label>
                )}
              </div>
            ) : (
              <div className="rounded border border-dashed border-white/15 bg-slate-950/40 p-3 text-xs text-slate-400">
                {t("inspector.empty")}
              </div>
            )}

            <h2 className="mb-3 mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("tracks.title")}
            </h2>
            <div className="space-y-2">
              {tracks.map((track) => (
                <div
                  key={track.id}
                  className="flex items-center justify-between rounded border border-white/10 bg-slate-950/60 px-3 py-2 text-xs"
                >
                  <span>{track.name}</span>
                  <span className="text-slate-400">{getTrackTypeLabel(track.type)}</span>
                </div>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                className="inline-flex items-center gap-1 rounded-md border border-cyan-300/40 bg-cyan-400/10 px-2 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20"
                onClick={() => setTracks((prev) => [...prev, createTrack("video")])}
              >
                <HiOutlinePlus />
                {t("tracks.addVideo")}
              </button>
              <button
                className="inline-flex items-center gap-1 rounded-md border border-indigo-300/40 bg-indigo-400/10 px-2 py-1 text-xs font-semibold text-indigo-100 hover:bg-indigo-400/20"
                onClick={() => setTracks((prev) => [...prev, createTrack("audio")])}
              >
                <HiOutlinePlus />
                {t("tracks.addAudio")}
              </button>
            </div>
          </aside>
        </section>

        <section className="border-t border-white/10 bg-slate-950/80 px-3 py-2">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
            <div className="flex items-center gap-2">
              <span>{t("timeline.zoom")}</span>
              <input
                type="range"
                min={timelineZoomRange.min}
                max={timelineZoomRange.max}
                value={pixelsPerSecond}
                onChange={(event) =>
                  setPixelsPerSecond(
                    clamp(
                      Number(event.target.value),
                      timelineZoomRange.min,
                      timelineZoomRange.max,
                    ),
                  )
                }
              />
            </div>
            <span>{t("timeline.label", { time: formatTimeLabel(timelineDuration) })}</span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-white/10 bg-slate-900/70">
            <div className="grid min-w-max grid-cols-[120px_1fr] border-b border-white/10">
              <div className="border-r border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t("tracks.title")}
              </div>
              <div className="relative h-8" style={{ width: timelineWidth }}>
                {rulerLabels.map((label) => (
                  <div
                    key={label.time}
                    className="absolute top-1 text-[10px] text-slate-500"
                    style={{ left: label.time * pixelsPerSecond + 4 }}
                  >
                    {label.label}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid min-w-max grid-cols-[120px_1fr]">
              <div className="border-r border-white/10">
                {tracks.map((track) => (
                  <div
                    key={track.id}
                    className="flex h-14 items-center justify-between border-b border-white/10 px-3 text-xs"
                  >
                    <span>{track.name}</span>
                    <span className="text-slate-500">{getTrackTypeLabel(track.type)}</span>
                  </div>
                ))}
              </div>

              <div className="relative">
                <div
                  ref={timelineInnerRef}
                  style={{ width: timelineWidth }}
                  onPointerDown={handleTimelinePointerDown}
                  onPointerMove={handleTimelinePointerMove}
                  onPointerUp={handleTimelinePointerUp}
                  onPointerCancel={handleTimelinePointerUp}
                >
                  {tracks.map((track) => (
                    <div
                      key={track.id}
                      className="relative h-14 border-b border-white/10 bg-slate-950/30"
                    >
                      {clips
                        .filter((clip) => clip.trackId === track.id)
                        .map((clip) => {
                          const left = clip.start * pixelsPerSecond;
                          const width = Math.max(8, clip.duration * pixelsPerSecond);
                          const asset = assetMap.get(clip.assetId);

                          const visualClipColor =
                            asset?.type === "image"
                              ? "border-amber-300/70 bg-amber-500/30"
                              : "border-cyan-300/70 bg-cyan-500/30";

                          const colorClass =
                            track.type === "audio"
                              ? "border-indigo-300/70 bg-indigo-500/30"
                              : visualClipColor;

                          const selectedClass =
                            clip.id === selectedClipId
                              ? "ring-1 ring-white/90"
                              : "ring-1 ring-transparent";

                          return (
                            <div
                              key={clip.id}
                              className={`absolute top-1.5 flex h-11 items-center overflow-hidden rounded-md border ${colorClass} ${selectedClass}`}
                              style={{ left, width }}
                              onPointerDown={(event) => startDrag(event, clip, "move")}
                            >
                              <div
                                className="h-full w-2 cursor-ew-resize border-r border-black/30 bg-black/30"
                                onPointerDown={(event) =>
                                  startDrag(event, clip, "trim-start")
                                }
                              />
                              <div className="min-w-0 flex-1 px-2 text-[11px] font-medium text-white">
                                <p className="truncate">{asset?.name ?? t("clip.defaultName")}</p>
                              </div>
                              <div
                                className="h-full w-2 cursor-ew-resize border-l border-black/30 bg-black/30"
                                onPointerDown={(event) =>
                                  startDrag(event, clip, "trim-end")
                                }
                              />
                            </div>
                          );
                        })}
                    </div>
                  ))}
                </div>

                <div
                  className="pointer-events-none absolute inset-y-0 z-20 w-px bg-rose-400"
                  style={{ left: effectivePlayhead * pixelsPerSecond }}
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
