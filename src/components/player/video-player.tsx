import { useRef, useEffect, useCallback, useState } from "react";
import { usePlayerStore } from "../../stores/player";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, Tooltip, TooltipTrigger } from "react-aria-components";
import {
  LuHouse,
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

  const {
    filePath,
    fileName,
    streamUrl,
    blobUrl,
    transcodeUrl,
    needsTranscode,
    timeOffset,
    playing,
    currentTime,
    duration,
    activeSubtitleTrack,
    setPlaying,
    setCurrentTime,
    setDuration,
    close,
    enableTranscoding,
    fetchSubtitleTracks,
  } = usePlayerStore();

  const fallbackToBlob = useCallback(async () => {
    if (!filePath || blobUrl) return;
    console.log("[video] falling back to blob URL");
    try {
      const bytes = await invoke<number[]>("read_file_bytes", {
        path: filePath,
      });
      const uint8 = new Uint8Array(bytes);
      const mime = (fileName ?? "").toLowerCase().endsWith(".mp4")
        ? "video/mp4"
        : "video/*";
      const url = URL.createObjectURL(new Blob([uint8], { type: mime }));
      usePlayerStore.setState({ blobUrl: url, streamUrl: null });
    } catch (e) {
      console.error("[video] blob fallback failed:", e);
    }
  }, [filePath, fileName, blobUrl]);

  // Determine effective source
  const src = transcodeUrl || streamUrl || blobUrl;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    triedTranscode.current = false;
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

    const onEnded = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    const onError = () => {
      const ve = video.error;
      console.error("[video] error:", ve?.code, ve?.message);
      setPlaying(false);

      console.log(
        "[video] onError eval: code=4",
        ve?.code === 4,
        "!needsTranscode",
        !needsTranscode,
        "!triedTranscode",
        !triedTranscode.current,
        "streamUrl",
        !!streamUrl,
        "!blobUrl",
        !blobUrl,
        "!transcodeUrl",
        !transcodeUrl,
      );

      if (ve?.code === 4 && !needsTranscode && !triedTranscode.current) {
        console.log("[video] source not supported, switching to transcoding");
        triedTranscode.current = true;
        enableTranscoding(speedRef.current);
        return;
      }

      if (streamUrl && !blobUrl && !transcodeUrl && !triedTranscode.current) {
        fallbackToBlob();
      }
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
      video.play().catch(() => setPlaying(false));
    };

    const onStalled = () => console.log("[video] stalled");
    const onWaiting = () => console.log("[video] waiting");

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

    video.play().catch(() => {});

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
    };
  }, [
    src,
    setPlaying,
    setCurrentTime,
    setDuration,
    fallbackToBlob,
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

  // Web Audio API for volume amplification
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!audioCtxRef.current) {
      try {
        const AudioContext =
          window.AudioContext || (window as any).webkitAudioContext;
        audioCtxRef.current = new AudioContext();
        gainNodeRef.current = audioCtxRef.current.createGain();

        const source = audioCtxRef.current.createMediaElementSource(video);
        source.connect(gainNodeRef.current);
        gainNodeRef.current.connect(audioCtxRef.current.destination);
      } catch (e) {
        console.error(
          "Failed to initialize Web Audio API for amplification:",
          e,
        );
      }
    }
  }, []);

  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (gainNodeRef.current) {
      video.volume = 1;
      gainNodeRef.current.gain.value = volume;
    } else {
      video.volume = Math.min(volume, 1);
    }
  }, [volume]);

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
    if (video.readyState >= 2) {
      if (playing) {
        video.play().catch(() => {});
        audioCtxRef.current?.resume();
      } else {
        video.pause();
        audioCtxRef.current?.suspend();
      }
    }
  }, [playing]);

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

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full flex-col overflow-hidden bg-black"
    >
      <KeyboardHandler
        onTogglePlay={togglePlay}
        onToggleFullscreen={toggleFullscreen}
        onSkipBack={skipBack}
        onSkipForward={skipForward}
        onShowIndicator={showIndicator}
      />
      <video
        ref={videoRef}
        className="h-full w-full"
        style={{ objectFit: FIT_OPTIONS.find((o) => o.id === fit)?.objectFit || 'contain' }}
        onDoubleClick={toggleFullscreen}
        playsInline
        preload="auto"
        crossOrigin="anonymous"
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
        className="absolute inset-x-0 top-0 z-10 bg-linear-to-b from-black to-transparent pb-6"
        style={{
          visibility: controlsVisible ? "visible" : "hidden",
          transition: "all 0.4s",
        }}
      >
        <div className="mx-auto flex max-w-[1600px] items-center gap-2 py-1.5">
          <TooltipTrigger>
            <Button
              onPress={close}
              className="flex cursor-pointer items-center justify-center rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            >
              <LuHouse size={16} />
            </Button>
            <Tooltip className="rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg">
              Go back
            </Tooltip>
          </TooltipTrigger>
          <span className="truncate text-sm font-medium text-white/60">
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
    </div>
  );
}
