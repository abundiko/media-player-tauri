import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { usePlayerStore } from "../../stores/player";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button, Tooltip, TooltipTrigger } from "react-aria-components";
import {
  LuFolderOpen,
  LuPlay,
  LuPause,
  LuSkipBack,
  LuSkipForward,
  LuMaximize2,
  LuMinimize2,
  LuVolume2,
  LuVolume,
} from "react-icons/lu";
import { PlayerControls } from "./player-controls";
import { KeyboardHandler } from "./keyboard-handler";
import { getSavedFit, saveFit, FIT_OPTIONS } from "./fit-control";
import { useLocalMediaStore } from "../../stores/local-media";
import { FolderMediaModal } from "../folder-media-modal";
import type { FolderMedia } from "../../stores/local-media";
import { AnimatedBackground } from "./animated-background";
import { EqualizerPopover } from "./equalizer-popover";
import { useEqualizerStore } from "../../stores/equalizer";
import {
  getResumePosition,
  setResumePosition,
  clearResumePosition,
} from "../../stores/resume";

const EXT_SUBTITLE_ID = -1;

interface VttCue {
  startTime: number;
  endTime: number;
  text: string;
}

function parseVttTimestamp(ts: string): number {
  const m = ts.match(/^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!m) return 0;
  return +(m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
}

function parseWebVTT(vtt: string): VttCue[] {
  const cues: VttCue[] = [];
  let currentStart = 0;
  let currentEnd = 0;
  let currentText: string[] = [];
  let inCue = false;

  for (const raw of vtt.split("\n")) {
    const line = raw.trim();

    if (line === "" || line === "WEBVTT") {
      if (inCue && currentText.length > 0) {
        cues.push({
          startTime: currentStart,
          endTime: currentEnd,
          text: currentText.join("<br />"),
        });
      }
      currentText = [];
      inCue = false;
      continue;
    }

    if (line.startsWith("STYLE") || line.startsWith("NOTE")) {
      inCue = false;
      continue;
    }

    const m = line.match(
      /^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})/,
    );
    if (m) {
      if (inCue && currentText.length > 0) {
        cues.push({
          startTime: currentStart,
          endTime: currentEnd,
          text: currentText.join("<br />"),
        });
      }
      currentStart = parseVttTimestamp(
        `${m[1] ? m[1] + ":" : ""}${m[2]}:${m[3]}.${m[4]}`,
      );
      currentEnd = parseVttTimestamp(
        `${m[5] ? m[5] + ":" : ""}${m[6]}:${m[7]}.${m[8]}`,
      );
      currentText = [];
      inCue = true;
      continue;
    }

    if (inCue) {
      currentText.push(line);
    }
  }

  if (inCue && currentText.length > 0) {
    cues.push({
      startTime: currentStart,
      endTime: currentEnd,
      text: currentText.join("<br />"),
    });
  }

  return cues;
}

function parseSRT(srt: string): VttCue[] {
  const cues: VttCue[] = [];
  let currentStart = 0;
  let currentEnd = 0;
  let currentText: string[] = [];
  let expectingIndex = true;

  for (const raw of srt.split("\n")) {
    const line = raw.trim();

    if (line === "") {
      if (currentText.length > 0) {
        cues.push({
          startTime: currentStart,
          endTime: currentEnd,
          text: currentText.join("<br />"),
        });
      }
      currentText = [];
      expectingIndex = true;
      continue;
    }

    if (expectingIndex && /^\d+$/.test(line)) {
      expectingIndex = false;
      continue;
    }

    const m = line.match(
      /^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})/,
    );
    if (m) {
      if (currentText.length > 0) {
        cues.push({
          startTime: currentStart,
          endTime: currentEnd,
          text: currentText.join("<br />"),
        });
      }
      currentStart = parseVttTimestamp(
        `${m[1] ? m[1] + ":" : ""}${m[2]}:${m[3]}.${m[4]}`,
      );
      currentEnd = parseVttTimestamp(
        `${m[5] ? m[5] + ":" : ""}${m[6]}:${m[7]}.${m[8]}`,
      );
      currentText = [];
      continue;
    }

    currentText.push(line);
  }

  if (currentText.length > 0) {
    cues.push({
      startTime: currentStart,
      endTime: currentEnd,
      text: currentText.join("<br />"),
    });
  }

  return cues;
}

function parseSubtitles(text: string): VttCue[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("WEBVTT")) return parseWebVTT(trimmed);
  return parseSRT(trimmed);
}

export function VideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const triedTranscode = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [indicator, setIndicator] = useState<{
    type: string;
    label?: string;
  } | null>(null);
  const indicatorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showIndicator = useCallback((type: string, label?: string) => {
    setIndicator({ type, label });
    if (indicatorTimer.current) clearTimeout(indicatorTimer.current);
    indicatorTimer.current = setTimeout(() => setIndicator(null), 1500);
  }, []);

  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [videoDimensions, setVideoDimensions] = useState({
    width: 0,
    height: 0,
  });
  const [fit, setFit] = useState(getSavedFit);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const [subtitleCues, setSubtitleCues] = useState<VttCue[]>([]);
  const [activeCue, setActiveCue] = useState<VttCue | null>(null);
  const [folderModal, setFolderModal] = useState<FolderMedia | null>(null);
  const [resumePos, setResumePos] = useState<number | null>(null);
  const videoFilters = useEqualizerStore((s) => s.video);

  const filterStyle = useMemo(
    () => ({
      objectFit: FIT_OPTIONS.find((o) => o.id === fit)?.objectFit || "contain",
      filter: `brightness(${videoFilters.brightness}%) contrast(${videoFilters.contrast}%) saturate(${videoFilters.saturation}%) hue-rotate(${videoFilters.hueRotate}deg) blur(${videoFilters.blur}px) grayscale(${videoFilters.grayscale}%) sepia(${videoFilters.sepia}%)`,
    }),
    [fit, videoFilters],
  );

  const {
    filePath,
    fileName,
    streamUrl,
    blobUrl,
    transcodeUrl,
    needsTranscode,
    timeOffset,
    isWebUrl,
    playing,
    currentTime,
    duration,
    activeSubtitleTrack,
    setPlaying,
    setCurrentTime,
    setDuration,
    enableTranscoding,
    fetchSubtitleTracks,
    checkSystemFfmpeg,
    isSystemFfmpeg,
    mediaError,
  } = usePlayerStore();

  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const reviveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseStartRef = useRef<number | null>(null);

  useEffect(() => {
    checkSystemFfmpeg();
  }, [checkSystemFfmpeg]);

  // Find which scanned folder contains the current file
  const foldersState = useLocalMediaStore((s) => s.folders);
  const explicitFolders = useLocalMediaStore((s) => s.explicitFolders);
  const currentFolder: FolderMedia | null = (() => {
    if (!filePath) return null;
    let best: FolderMedia | null = null;
    let bestLen = 0;
    for (const [key, f] of Object.entries(foldersState)) {
      if (f.path === "history") continue;
      if (!explicitFolders.includes(key)) continue;
      const sep = f.path.endsWith("/") || f.path.endsWith("\\") ? "" : "/";
      const prefix = f.path + sep;
      if (filePath.startsWith(prefix) && prefix.length > bestLen) {
        best = f;
        bestLen = prefix.length;
      }
    }
    return best;
  })();

  // Fallback: if streaming fails and blob is too risky for large files,
  // switch to the transcoding pipeline which streams incrementally.
  const fallbackToTranscode = useCallback(async () => {
    if (!filePath) return;
    console.log("[video] falling back to transcoding pipeline");
    triedTranscode.current = true;
    enableTranscoding(speedRef.current);
  }, [filePath, enableTranscoding]);

  // Determine effective source
  const src = transcodeUrl || streamUrl || blobUrl;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    triedTranscode.current = false;
    setPlaybackError(null);
    console.log("[video] setting src to:", src);
    video.src = src;
    video.load();
    if (!needsTranscode) video.playbackRate = speedRef.current;

    const onTimeUpdate = () => {
      if (!needsTranscode) video.playbackRate = speedRef.current;
      if (needsTranscode) {
        setCurrentTime(timeOffset + video.currentTime * speedRef.current);
      } else {
        setCurrentTime(video.currentTime);
      }
    };

    const onDurationChange = () => {
      if (!needsTranscode) {
        setDuration(video.duration || 0);
      }
    };

    const onEnded = () => {
      setPlaying(false);
      const p = usePlayerStore.getState().filePath;
      if (p) clearResumePosition(p);
    };
    const onPlay = () => {
      pauseStartRef.current = null;
      setPlaying(true);
    };
    const onPause = () => {
      pauseStartRef.current = Date.now();
      setPlaying(false);
    };

    const onError = () => {
      const ve = video.error;
      console.error("[video] error:", ve?.code, ve?.message);
      setPlaying(false);

      const isWeb = usePlayerStore.getState().isWebUrl;

      if (isWeb) {
        setPlaybackError(
          "This URL could not be played. The server may not support direct video streaming, or the link may be invalid. YouTube and IMDb links are not yet supported.",
        );
        return;
      }

      if (ve?.code === 4 && !needsTranscode && !triedTranscode.current) {
        console.log("[video] source not supported, switching to transcoding");
        triedTranscode.current = true;
        enableTranscoding(speedRef.current);
        return;
      }

      if (streamUrl && !blobUrl && !transcodeUrl && !triedTranscode.current) {
        fallbackToTranscode();
        return;
      }

      // All retries exhausted — the file was likely moved or deleted
      setPlaybackError(
        "This file could not be found. It may have been moved or deleted.",
      );
    };

    const onLoadStart = () => console.log("[video] loadstart");

    const onLoadedMetadata = () => {
      console.log(
        "[video] loadedmetadata",
        video.videoWidth,
        video.videoHeight,
      );
      setVideoDimensions({
        width: video.videoWidth,
        height: video.videoHeight,
      });
      if (
        video.videoWidth === 0 &&
        !needsTranscode &&
        !triedTranscode.current
      ) {
        console.log(
          "[video] videoWidth=0 → codec unsupported, switching to transcoding",
        );
        triedTranscode.current = true;
        enableTranscoding(speedRef.current);
        return;
      }
    };

    const onCanPlay = () => {
      console.log("[video] canplay");
      if (reviveTimeoutRef.current) {
        clearTimeout(reviveTimeoutRef.current);
        reviveTimeoutRef.current = null;
      }
      // Only auto-play if the user hasn't explicitly paused
      if (!pauseStartRef.current) {
        video.play().catch(() => setPlaying(false));
      }
    };

    const onStalled = () => console.log("[video] stalled");
    const onWaiting = () => {
      console.log("[video] waiting");
      if (!needsTranscode) return;
      // If the network dropped (NETWORK_IDLE = 1) while waiting, the server
      // likely killed the idle TCP connection during a long pause.
      // Start a 1.5s grace period; if the stream doesn't recover, revive it.
      if (video.networkState === HTMLMediaElement.NETWORK_IDLE) {
        console.log("[video] waiting with idle network — scheduling revive");
        if (reviveTimeoutRef.current) clearTimeout(reviveTimeoutRef.current);
        reviveTimeoutRef.current = setTimeout(() => {
          if (!reviveTimeoutRef.current) return;
          reviveTimeoutRef.current = null;
          const s = usePlayerStore.getState();
          const v = videoRef.current;
          if (!v || !s.needsTranscode) return;
          console.log("[video] auto-reviving transcoded stream");
          v.currentTime = v.currentTime; // flush any pending decode
          s.seekTranscode(
            s.timeOffset + v.currentTime * speedRef.current,
            speedRef.current,
          );
        }, 1500);
      } else {
        if (reviveTimeoutRef.current) {
          clearTimeout(reviveTimeoutRef.current);
          reviveTimeoutRef.current = null;
        }
      }
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("ended", onEnded);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("error", onError);
    video.addEventListener("loadstart", onLoadStart);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("waiting", onWaiting);

    if (!pauseStartRef.current) {
      video.play().catch(() => {});
    }

    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("error", onError);
      video.removeEventListener("loadstart", onLoadStart);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("waiting", onWaiting);
      if (reviveTimeoutRef.current) {
        clearTimeout(reviveTimeoutRef.current);
        reviveTimeoutRef.current = null;
      }
      // Force the browser to close the TCP connection to the media server.
      // Just removeAttribute('src') leaves the socket open in Chrome/WebKit,
      // which prevents the Rust backend from detecting a disconnect — the
      // FFmpeg transcoder keeps running as a zombie process.
      video.src = "";
      video.load();
      video.removeAttribute("src");
    };
  }, [
    src,
    setPlaying,
    setCurrentTime,
    setDuration,
    needsTranscode,
    timeOffset,
    enableTranscoding,
    streamUrl,
    blobUrl,
    transcodeUrl,
  ]);

  // Fetch subtitle tracks when filePath changes
  useEffect(() => {
    if (filePath) {
      fetchSubtitleTracks();
    } else {
      usePlayerStore.setState({
        subtitleTracks: [],
        activeSubtitleTrack: null,
      });
    }
  }, [filePath, fetchSubtitleTracks]);

  // Web Audio API for volume amplification + equalizer
  // Skipped for web URLs — createMediaElementSource requires CORS access to
  // the video's audio data, which remote servers typically don't provide.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const eqNodesRef = useRef<BiquadFilterNode[]>([]);
  const audioCtxStarted = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || audioCtxRef.current || isWebUrl) return;
    mountedRef.current = true;

    try {
      const AudioContext =
        window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new AudioContext();
      gainNodeRef.current = audioCtxRef.current.createGain();

      const source = audioCtxRef.current.createMediaElementSource(video);

      // Create 10-band equalizer filter chain with peaking filters
      const freqs = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
      const filters = freqs.map((freq) => {
        const filter = audioCtxRef.current!.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = freq;
        filter.Q.value = 1.41;
        filter.gain.value = 0;
        return filter;
      });
      eqNodesRef.current = filters;

      // Chain: source → filter1 → ... → filter10 → gainNode → destination
      let prev: AudioNode = source;
      for (const filter of filters) {
        prev.connect(filter);
        prev = filter;
      }
      prev.connect(gainNodeRef.current);
      gainNodeRef.current.connect(audioCtxRef.current.destination);
      audioCtxStarted.current = true;
    } catch (e) {
      console.error("Failed to initialize Web Audio API for amplification:", e);
    }

    return () => {
      // Defer AudioContext close — createMediaElementSource permanently binds
      // the video element to this AudioContext.  In React 19 StrictMode the
      // component is unmounted and remounted once in development; if we close
      // synchronously the video goes silent and the remount cannot re-bind.
      // By deferring with setTimeout(0), the real mount sets mountedRef=true
      // before the close runs, keeping the AudioContext alive across the
      // StrictMode double-mount cycle.
      mountedRef.current = false;
      setTimeout(() => {
        if (!mountedRef.current && audioCtxRef.current) {
          audioCtxRef.current.close().catch(() => {});
          audioCtxRef.current = null;
          gainNodeRef.current = null;
          eqNodesRef.current = [];
          audioCtxStarted.current = false;
        }
      }, 0);
    };
  }, [isWebUrl]);

  // Sync audio equalizer band gains from store to Web Audio nodes
  const audioBands = useEqualizerStore((s) => s.audio);
  useEffect(() => {
    const nodes = eqNodesRef.current;
    if (nodes.length === 0) return;
    nodes.forEach((node, i) => {
      node.gain.value = audioBands[i] ?? 0;
    });
  }, [audioBands]);

  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (gainNodeRef.current && !isWebUrl) {
      video.volume = 1;
      gainNodeRef.current.gain.value = volume;
    } else {
      video.volume = Math.min(volume, 1);
    }
  }, [volume, isWebUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!needsTranscode) video.playbackRate = speed;
    console.log("[speed] set playbackRate to", speed);
  }, [speed]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
  }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [playing]);

  // ── Resume playback ────────────────────────────────────────────

  const prevFilePathRef = useRef(filePath);

  // Check for resume position when a file is loaded
  useEffect(() => {
    if (!filePath) {
      setResumePos(null);
      return;
    }
    const pos = getResumePosition(filePath);
    setResumePos(pos);
  }, [filePath]);

  // Auto-seek to resume position when video can play
  const prevSrcRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src || !resumePos) return;
    if (prevSrcRef.current === src) return;
    prevSrcRef.current = src;

    const seek = () => {
      const state = usePlayerStore.getState();
      const d = state.duration || video.duration;
      const offset = state.timeOffset;

      if (Number.isFinite(d) && d > 0) {
        if (resumePos >= d - 10) {
          clearResumePosition(state.filePath!);
          setResumePos(null);
          return;
        }
        if (resumePos >= d) {
          setResumePos(null);
          return;
        }
      }

      // For transcoded streams, video.currentTime is relative to the transcode
      // start position (timeOffset).  Adjust the seek target accordingly.
      const seekTo = Math.max(0, resumePos - offset);
      if (seekTo > 0.5) {
        video.currentTime = seekTo;
      }
      video.removeEventListener("canplay", seek);
    };
    video.addEventListener("canplay", seek);
    return () => video.removeEventListener("canplay", seek);
  }, [src, resumePos]);

  // Save position periodically during playback
  useEffect(() => {
    if (!filePath || !playing) return;
    const interval = setInterval(() => {
      const t = currentTimeRef.current;
      if (t > 10) setResumePosition(filePath, t);
    }, 15000);
    return () => clearInterval(interval);
  }, [filePath, playing]);

  // Save position on pause
  useEffect(() => {
    if (!filePath || playing) return;
    const t = currentTimeRef.current;
    if (t > 10) setResumePosition(filePath, t);
  }, [filePath, playing]);

  // Save position when the file is closed (filePath becomes null)
  useEffect(() => {
    if (prevFilePathRef.current && !filePath) {
      const t = currentTimeRef.current;
      if (t > 10) setResumePosition(prevFilePathRef.current, t);
    }
    prevFilePathRef.current = filePath;
  }, [filePath]);

  // Auto-hide controls on inactivity
  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onMove = () => showControls();
    container.addEventListener("mousemove", onMove);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
    return () => {
      container.removeEventListener("mousemove", onMove);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [showControls]);

  // Track fullscreen state
  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current?.requestFullscreen();
    }
  }, []);

  const [externalCues, setExternalCues] = useState<VttCue[]>([]);
  const [externalFileName, setExternalFileName] = useState<string | null>(null);

  const handlePickSubtitleFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Subtitle files",
          extensions: ["srt", "vtt", "ass", "ssa", "sub"],
        },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (!selected) return;

    try {
      const bytes = await invoke<number[]>("read_file_bytes", {
        path: selected,
      });
      const text = new TextDecoder().decode(new Uint8Array(bytes));
      const cues = parseSubtitles(text);
      if (cues.length === 0) {
        console.warn("[subtitles] no cues found in file:", selected);
        return;
      }
      setExternalCues(cues);
      const name = selected.replace(/\\/g, "/").split("/").pop() || selected;
      setExternalFileName(name);
      usePlayerStore.setState({ activeSubtitleTrack: EXT_SUBTITLE_ID });
    } catch (e) {
      console.error("[subtitles] failed to read external file:", e);
    }
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    const state = usePlayerStore.getState();

    if (state.playing) {
      state.setPlaying(false);
    } else if (video && video.ended) {
      state.setCurrentTime(0);
      if (!state.needsTranscode && video) video.currentTime = 0;
      state.setPlaying(true);
    } else {
      state.setPlaying(true);
    }
  }, []);

  const onChangeFit = useCallback((id: string) => {
    setFit(id);
    saveFit(id);
  }, []);

  const onChangeSpeed = useCallback((s: number) => {
    console.log("[speed] onChangeSpeed called with", s);
    setSpeed(s);
    const state = usePlayerStore.getState();
    if (state.needsTranscode) {
      state.seekTranscode(state.currentTime, s);
    } else if (videoRef.current) {
      videoRef.current.playbackRate = s;
      console.log("[speed] set, reading back:", videoRef.current.playbackRate);
    }
  }, []);

  const handleSeek = useCallback(
    (t: number) => {
      setCurrentTime(t);
      if (needsTranscode) {
        usePlayerStore.getState().seekTranscode(t, speedRef.current);
      } else if (videoRef.current) {
        videoRef.current.currentTime = t;
      }
    },
    [setCurrentTime, needsTranscode],
  );

  const skipBack = useCallback(() => {
    const t = Math.max(0, currentTime - 10);
    if (needsTranscode) {
      usePlayerStore.getState().seekTranscode(t, speedRef.current);
    } else if (videoRef.current) {
      videoRef.current.currentTime = t;
      setCurrentTime(t);
    }
  }, [currentTime, needsTranscode, setCurrentTime]);

  const skipForward = useCallback(() => {
    const t = Math.min(duration, currentTime + 10);
    if (needsTranscode) {
      usePlayerStore.getState().seekTranscode(t, speedRef.current);
    } else if (videoRef.current) {
      videoRef.current.currentTime = t;
      setCurrentTime(t);
    }
  }, [currentTime, duration, needsTranscode, setCurrentTime]);

  // Clear external subtitles when the file closes or changes
  useEffect(() => {
    if (!filePath) {
      setExternalCues([]);
      setExternalFileName(null);
    }
  }, [filePath]);

  // Compute subtitle base URL from the streaming source
  const subtitleBaseUrl =
    (streamUrl || transcodeUrl) && !blobUrl
      ? new URL(streamUrl || transcodeUrl!).origin
      : null;

  // Send periodic keepalives to prevent the server from killing the transcode
  // stream while the user is on the player screen (even if paused).
  useEffect(() => {
    const baseUrl = subtitleBaseUrl;
    if (!baseUrl || !filePath) return;
    const encoded = encodeURIComponent(filePath);
    const interval = setInterval(() => {
      fetch(`${baseUrl}/keepalive?path=${encoded}`).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [filePath, subtitleBaseUrl]);

  // On window focus, if the video has been paused > 60 seconds,
  // auto-reconnect the transcoded stream (the TCP connection may have died).
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    appWindow
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) return;
        if (!pauseStartRef.current) return;
        const pausedMs = Date.now() - pauseStartRef.current;
        if (pausedMs < 60000) return;

        const state = usePlayerStore.getState();
        if (!state.needsTranscode || !state.filePath) return;
        console.log(
          "[video] window focused, auto-reconnecting after long pause",
        );
        state.seekTranscode(state.currentTime, speedRef.current);
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, []);

  // Fetch full WebVTT once when active track changes (not on every seek)
  useEffect(() => {
    if (activeSubtitleTrack === null || !subtitleBaseUrl || !filePath) {
      setSubtitleCues([]);
      return;
    }

    let cancelled = false;
    const url = `${subtitleBaseUrl}/subtitle?path=${encodeURIComponent(filePath)}&track=${activeSubtitleTrack}`;

    fetch(url)
      .then((r) => r.text())
      .then((vtt) => {
        if (!cancelled) setSubtitleCues(parseWebVTT(vtt));
      })
      .catch((e) => console.error("[subtitles] fetch failed:", e));

    return () => {
      cancelled = true;
    };
  }, [activeSubtitleTrack, subtitleBaseUrl, filePath]);

  // Find the active cue based on store's absolute currentTime
  useEffect(() => {
    const cues =
      activeSubtitleTrack === EXT_SUBTITLE_ID ? externalCues : subtitleCues;
    const cue = cues.find(
      (c) => c.startTime <= currentTime && currentTime < c.endTime,
    );
    setActiveCue(cue ?? null);
  }, [currentTime, subtitleCues, externalCues, activeSubtitleTrack]);

  // Auto-dismiss resume dialog after 10s
  useEffect(() => {
    if (!resumePos) return;
    const timer = setTimeout(() => setResumePos(null), 10000);
    return () => clearTimeout(timer);
  }, [resumePos]);

  // Sync store-level media errors into local playbackError for modal display
  const prevMediaErrorRef = useRef(mediaError);
  useEffect(() => {
    if (mediaError && mediaError !== prevMediaErrorRef.current) {
      setPlaybackError(mediaError);
    }
    prevMediaErrorRef.current = mediaError;
  }, [mediaError]);

  function fmtTime(s: number): string {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0)
      return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-black"
    >
      <KeyboardHandler
        onTogglePlay={togglePlay}
        onToggleFullscreen={toggleFullscreen}
        onSkipBack={skipBack}
        onSkipForward={skipForward}
        onShowIndicator={showIndicator}
      />
      <AnimatedBackground playing={playing} />

      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full"
        style={filterStyle}
        onDoubleClick={toggleFullscreen}
        playsInline
        preload="auto"
        crossOrigin={isWebUrl ? undefined : "anonymous"}
      />

      {indicator && (
        <div className="pointer-events-none absolute right-4 top-14 z-30 flex items-center gap-2 rounded-lg bg-black/60 px-3 py-2 backdrop-blur-sm">
          {indicator.type === "play" && (
            <LuPlay size={22} className="text-white" />
          )}
          {indicator.type === "pause" && (
            <LuPause size={22} className="text-white" />
          )}
          {indicator.type === "forward" && (
            <LuSkipForward size={22} className="text-white" />
          )}
          {indicator.type === "backward" && (
            <LuSkipBack size={22} className="text-white" />
          )}
          {indicator.type === "volume-up" && (
            <LuVolume2 size={22} className="text-white" />
          )}
          {indicator.type === "volume-down" && (
            <LuVolume size={22} className="text-white" />
          )}
          {indicator.type === "fullscreen" &&
            (indicator.label === "ON" ? (
              <LuMaximize2 size={22} className="text-white" />
            ) : (
              <LuMinimize2 size={22} className="text-white" />
            ))}
          <span className="text-sm font-bold text-white">
            {indicator.label}
          </span>
        </div>
      )}

      {resumePos && (
        <div className="absolute right-4 top-20 z-30 flex items-center gap-3 rounded-lg bg-black/80 px-3 py-2.5 backdrop-blur-sm shadow-lg animate-fade-in">
          <span className="text-xs text-white/80">
            Continuing from{" "}
            <span className="font-medium text-white">{fmtTime(resumePos)}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              const video = videoRef.current;
              if (video) video.currentTime = 0;
              if (filePath) clearResumePosition(filePath);
              setResumePos(null);
            }}
            className="rounded px-2 py-0.5 text-[11px] text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            Start over
          </button>
          <button
            type="button"
            onClick={() => setResumePos(null)}
            className="flex items-center justify-center rounded p-0.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>
      )}

      {activeCue && (
        <div
          className="pointer-events-none absolute inset-x-0 z-20 flex justify-center"
          style={{
            bottom: controlsVisible ? "11rem" : "2rem",
            transition: "bottom 0.3s",
          }}
        >
          <span
            className="text-center text-2xl leading-relaxed text-white"
            style={{
              textShadow:
                "2px 2px 6px rgba(0,0,0,0.95), 0 0 4px rgba(0,0,0,0.8)",
            }}
            dangerouslySetInnerHTML={{ __html: activeCue.text }}
          />
        </div>
      )}

      <div
        onMouseEnter={() => {
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          setControlsVisible(true);
        }}
        onMouseLeave={showControls}
        className="absolute inset-x-0 top-0 z-10 bg-linear-to-b from-black to-transparent pb-6"
        style={{
          visibility: controlsVisible ? "visible" : "hidden",
          transition: "all 0.4s",
        }}
      >
        <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-10 py-1.5">
          {/*<TooltipTrigger>
            <Button
              onPress={close}
              className="flex cursor-pointer items-center justify-center rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            >
              <LuHouse size={16} />
            </Button>
            <Tooltip className="rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg">
              Go back
            </Tooltip>
          </TooltipTrigger>*/}
          {currentFolder && (
            <TooltipTrigger>
              <Button
                onPress={() => setFolderModal(currentFolder)}
                className="flex cursor-pointer items-center justify-center rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              >
                <LuFolderOpen size={16} />
              </Button>
              <Tooltip className="rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg">
                {currentFolder.name}
              </Tooltip>
            </TooltipTrigger>
          )}
          <EqualizerPopover />
          {isSystemFfmpeg && (
            <TooltipTrigger>
              <div className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
              <Tooltip className="rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg">
                Using system FFmpeg fallback
              </Tooltip>
            </TooltipTrigger>
          )}
          <span className="truncate text-sm font-semibold text-white/60">
            {fileName}
          </span>
          {needsTranscode && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              TRANSCODING
            </span>
          )}
          {videoDimensions.width > 0 && videoDimensions.height > 0 && (
            <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">
              {videoDimensions.width}x{videoDimensions.height}
            </span>
          )}
        </div>
      </div>

      <div
        onMouseEnter={() => {
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          setControlsVisible(true);
        }}
        onMouseLeave={showControls}
        className="absolute inset-x-0 bottom-0 z-10 transition-all duration-300"
        style={{
          transform: controlsVisible ? "translateY(0)" : "translateY(100%)",
          opacity: controlsVisible ? 1 : 0,
          pointerEvents: controlsVisible ? "auto" : "none",
        }}
      >
        <div className="bg-linear-to-t from-black/80 to-transparent px-4 pb-3 pt-10">
          <PlayerControls
            currentTime={currentTime}
            duration={duration}
            playing={playing}
            fullscreen={fullscreen}
            fit={fit}
            speed={speed}
            onSeek={handleSeek}
            onTogglePlay={togglePlay}
            onSkipBack={skipBack}
            onSkipForward={skipForward}
            onToggleFullscreen={toggleFullscreen}
            onChangeFit={onChangeFit}
            onChangeSpeed={onChangeSpeed}
            onPickSubtitleFile={handlePickSubtitleFile}
            externalSubtitleFileName={externalFileName}
          />
        </div>
      </div>

      {folderModal && (
        <FolderMediaModal
          folder={folderModal}
          onClose={() => setFolderModal(null)}
        />
      )}

      {playbackError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="mx-4 flex max-w-md flex-col gap-4 rounded-2xl border border-border bg-surface-alt p-6 shadow-2xl backdrop-blur-xl">
            <h3 className="text-base font-semibold text-text">
              Playback Error
            </h3>
            <p className="text-sm leading-relaxed text-text-muted">
              {playbackError}
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setPlaybackError(null);
                  usePlayerStore.setState({ mediaError: null });
                }}
                className="rounded-lg bg-surface-alt px-4 py-2 text-sm font-medium text-text transition-colors hover:opacity-90"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlaybackError(null);
                  close();
                }}
                className="rounded-lg bg-text px-4 py-2 text-sm font-medium text-surface transition-colors hover:opacity-90"
              >
                Go back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
