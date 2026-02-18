import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  HiOutlineMusicalNote,
  HiOutlinePause,
  HiOutlinePhoto,
  HiOutlinePlay,
  HiOutlinePlus,
  HiOutlineScissors,
  HiOutlineTrash,
  HiOutlineVideoCamera,
} from "react-icons/hi2";

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

function generateId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(value: number) {
  if (!Number.isFinite(value)) return "--:--";
  const total = Math.max(0, value);
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  const hundredths = Math.floor((total % 1) * 100);
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${hundredths.toString().padStart(2, "0")}`;
}

function getAssetTypeLabel(type: MediaType) {
  if (type === "video") return "Video";
  if (type === "audio") return "Audio";
  return "Image";
}

async function loadMediaAsset(file: File, type: MediaType): Promise<MediaAsset> {
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
        reject(new Error("이미지 정보를 불러오지 못했습니다."));
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
      }

      resolve(asset);
    };

    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("미디어 정보를 불러오지 못했습니다."));
    };
  });
}

export default function App() {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [tracks, setTracks] = useState<Track[]>([
    { id: generateId(), name: "V1", type: "video" },
    { id: generateId(), name: "A1", type: "audio" },
  ]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(75);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const timelineInnerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const scrubPointerIdRef = useRef<number | null>(null);
  const activeVideoClipRef = useRef<string | null>(null);
  const pendingVideoSeekRef = useRef<number | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const assetsRef = useRef<MediaAsset[]>([]);

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

  const timelineWidth = timelineDuration * pixelsPerSecond;
  const effectivePlayhead = Math.min(playhead, timelineDuration);

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
      return (
        track?.type === "audio" &&
        asset?.type === "audio" &&
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
        loaded.push(await loadMediaAsset(file, type));
      }
      setAssets((prev) => [...prev, ...loaded]);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "파일을 불러오지 못했습니다.");
    }
  }, []);

  const handleAddClip = useCallback(
    (asset: MediaAsset, targetTrackType: TrackType) => {
      if (targetTrackType === "video" && asset.type === "audio") {
        setStatusMessage("오디오 파일은 비디오 트랙에 추가할 수 없습니다.");
        return;
      }

      if (targetTrackType === "audio" && asset.type !== "audio") {
        setStatusMessage("오디오 트랙에는 오디오 파일만 추가할 수 있습니다.");
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

      setClips((prev) => [...prev, nextClip]);
      setSelectedClipId(nextClip.id);
      setStatusMessage(null);
    },
    [clips, ensureTrack],
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
      setStatusMessage("분할 지점이 클립 경계에 너무 가깝습니다.");
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
  }, [assetMap, effectivePlayhead, selectedClip]);

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
      labels.push({ time, label: `${time}s` });
    }

    return labels;
  }, [timelineDuration]);

  return (
    <div className="h-full bg-slate-950 text-slate-100">
      <div className="flex h-full flex-col">
        <header className="border-b border-white/10 bg-slate-900/90 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold tracking-wide text-cyan-300">NebulaCut</p>
              <p className="text-xs text-slate-400">Electron Local Video Editor</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="inline-flex items-center gap-1 rounded-md border border-cyan-300/40 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/20"
                onClick={() => videoInputRef.current?.click()}
              >
                <HiOutlineVideoCamera className="text-sm" />
                비디오 추가
              </button>
              <button
                className="inline-flex items-center gap-1 rounded-md border border-amber-300/40 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-400/20"
                onClick={() => imageInputRef.current?.click()}
              >
                <HiOutlinePhoto className="text-sm" />
                이미지 추가
              </button>
              <button
                className="inline-flex items-center gap-1 rounded-md border border-indigo-300/40 bg-indigo-400/10 px-3 py-1.5 text-xs font-semibold text-indigo-100 hover:bg-indigo-400/20"
                onClick={() => audioInputRef.current?.click()}
              >
                <HiOutlineMusicalNote className="text-sm" />
                오디오 추가
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

        <section className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-white/5 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
          <aside className="min-h-0 overflow-y-auto bg-slate-900/60 p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Media Library
            </h2>
            {assets.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/40 p-3 text-xs text-slate-400">
                비디오, 이미지, 오디오를 추가해서 타임라인을 구성하세요.
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
                        <span>{formatTime(asset.duration)}</span>
                      </div>
                      <div className="mt-2 flex gap-2">
                        {canToVideo && (
                          <button
                            className="rounded border border-cyan-300/40 bg-cyan-400/10 px-2 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-400/20"
                            onClick={() => handleAddClip(asset, "video")}
                          >
                            + 비디오 트랙
                          </button>
                        )}
                        {canToAudio && (
                          <button
                            className="rounded border border-indigo-300/40 bg-indigo-400/10 px-2 py-1 text-[11px] font-semibold text-indigo-100 hover:bg-indigo-400/20"
                            onClick={() => handleAddClip(asset, "audio")}
                          >
                            + 오디오 트랙
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
                    타임라인에 클립을 추가하세요
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
                    {isPlaying ? "일시정지" : "재생"}
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
                    onClick={handleSplitClip}
                  >
                    <HiOutlineScissors />
                    분할
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded-md border border-rose-300/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/20"
                    onClick={handleDeleteClip}
                  >
                    <HiOutlineTrash />
                    삭제
                  </button>
                </div>
                <div className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300">
                  Playhead {formatTime(effectivePlayhead)}
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-white/10 bg-slate-900/60 p-3">
                <p className="text-slate-400">타임라인 길이</p>
                <p className="mt-1 font-semibold text-white">{formatTime(timelineDuration)}</p>
              </div>
              <div className="rounded border border-white/10 bg-slate-900/60 p-3">
                <p className="text-slate-400">클립 수</p>
                <p className="mt-1 font-semibold text-white">{clips.length}</p>
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
              Inspector
            </h2>

            {selectedClip ? (
              <div className="space-y-3">
                <div className="rounded border border-white/10 bg-slate-950/60 p-3 text-xs text-slate-300">
                  <p>Clip ID: {selectedClip.id.slice(0, 8)}</p>
                  <p className="mt-1">Type: {selectedAsset ? getAssetTypeLabel(selectedAsset.type) : "-"}</p>
                </div>

                <label className="block text-xs text-slate-300">
                  시작 (s)
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
                  길이 (s)
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
                    오프셋 (s)
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
                    볼륨
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
                타임라인에서 클립을 선택하면 편집 항목이 표시됩니다.
              </div>
            )}

            <h2 className="mb-3 mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Tracks
            </h2>
            <div className="space-y-2">
              {tracks.map((track) => (
                <div
                  key={track.id}
                  className="flex items-center justify-between rounded border border-white/10 bg-slate-950/60 px-3 py-2 text-xs"
                >
                  <span>{track.name}</span>
                  <span className="text-slate-400">{track.type}</span>
                </div>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                className="inline-flex items-center gap-1 rounded-md border border-cyan-300/40 bg-cyan-400/10 px-2 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20"
                onClick={() => setTracks((prev) => [...prev, createTrack("video")])}
              >
                <HiOutlinePlus />
                비디오 트랙
              </button>
              <button
                className="inline-flex items-center gap-1 rounded-md border border-indigo-300/40 bg-indigo-400/10 px-2 py-1 text-xs font-semibold text-indigo-100 hover:bg-indigo-400/20"
                onClick={() => setTracks((prev) => [...prev, createTrack("audio")])}
              >
                <HiOutlinePlus />
                오디오 트랙
              </button>
            </div>
          </aside>
        </section>

        <section className="border-t border-white/10 bg-slate-950/80 px-3 py-2">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
            <div className="flex items-center gap-2">
              <span>Zoom</span>
              <input
                type="range"
                min="40"
                max="160"
                value={pixelsPerSecond}
                onChange={(event) => setPixelsPerSecond(Number(event.target.value))}
              />
            </div>
            <span>Timeline {formatTime(timelineDuration)}</span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-white/10 bg-slate-900/70">
            <div className="grid min-w-max grid-cols-[120px_1fr] border-b border-white/10">
              <div className="border-r border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Tracks
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
                    <span className="text-slate-500">{track.type}</span>
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
                                <p className="truncate">{asset?.name ?? "Clip"}</p>
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
