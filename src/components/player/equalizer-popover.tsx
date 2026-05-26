import { useState, useRef, useEffect } from "react";
import { Button, Tooltip, TooltipTrigger } from "react-aria-components";
import { LuAudioLines } from "react-icons/lu";
import { useEqualizerStore, VIDEO_PRESETS, AUDIO_PRESETS, BAND_FREQUENCIES } from "../../stores/equalizer";
import type { VideoFilters } from "../../stores/equalizer";

const VIDEO_LABELS: { key: keyof VideoFilters; label: string; min: number; max: number; step: number }[] = [
  { key: "brightness", label: "Brightness", min: 0, max: 200, step: 1 },
  { key: "contrast", label: "Contrast", min: 0, max: 200, step: 1 },
  { key: "saturation", label: "Saturation", min: 0, max: 200, step: 1 },
  { key: "hueRotate", label: "Hue", min: 0, max: 360, step: 1 },
  { key: "blur", label: "Blur", min: 0, max: 20, step: 0.5 },
  { key: "grayscale", label: "Grayscale", min: 0, max: 100, step: 1 },
  { key: "sepia", label: "Sepia", min: 0, max: 100, step: 1 },
];

const AUDIO_PRESET_NAMES = Object.keys(AUDIO_PRESETS);
const VIDEO_PRESET_NAMES = Object.keys(VIDEO_PRESETS);

function fmtHz(freq: number): string {
  return freq >= 1000 ? `${freq / 1000}kHz` : `${freq}Hz`;
}

function PresetSelect({
  presets,
  value,
  onChange,
}: {
  presets: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded border border-border px-2 py-1 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
      >
        <span className="capitalize">{value}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="ml-1 shrink-0">
          <path d="M2 3l3 4 3-4" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-full overflow-hidden rounded-lg border border-border py-1 shadow-lg backdrop-blur-xl"
          style={{ background: "var(--surface-alt)" }}
        >
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => { onChange(p); setOpen(false); }}
              className={`w-full px-2 py-1 text-left text-xs capitalize transition-colors hover:bg-surface-hover ${
                value === p ? "text-cyan-400" : "text-text-muted"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] text-text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 appearance-none rounded-full bg-white/20 accent-white cursor-pointer
          [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
      />
      <span className="w-8 text-right text-[11px] text-text-muted">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

export function EqualizerPopover() {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const video = useEqualizerStore((s) => s.video);
  const audio = useEqualizerStore((s) => s.audio);
  const videoPreset = useEqualizerStore((s) => s.videoPreset);
  const audioPreset = useEqualizerStore((s) => s.audioPreset);
  const setVideoFilter = useEqualizerStore((s) => s.setVideoFilter);
  const applyVideoPreset = useEqualizerStore((s) => s.applyVideoPreset);
  const setAudioBand = useEqualizerStore((s) => s.setAudioBand);
  const applyAudioPreset = useEqualizerStore((s) => s.applyAudioPreset);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const isVideoActive = videoPreset !== "default" || Object.values(video).some((v) => v !== 100 && v !== 0);
  const isAudioActive = audioPreset !== "default" || audio.some((v) => v !== 0);

  return (
    <div className="relative">
      <TooltipTrigger>
        <Button
          onPress={() => setOpen((o) => !o)}
          className={`flex cursor-pointer items-center justify-center transition-colors hover:text-white ${
            isVideoActive || isAudioActive ? "text-cyan-400" : "text-white/50"
          }`}
        >
          <LuAudioLines size={16} />
        </Button>
        <Tooltip className="rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg">
          Equalizer
        </Tooltip>
      </TooltipTrigger>

      {open && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-full z-50 mt-2 min-w-[520px] rounded-lg border border-border shadow-lg backdrop-blur-xl"
          style={{ background: "var(--surface-alt)" }}
        >
          <div className="grid grid-cols-2 divide-x divide-border">
            {/* Video column */}
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text">Video</span>
                <div className="w-28">
                  <PresetSelect presets={VIDEO_PRESET_NAMES} value={videoPreset} onChange={applyVideoPreset} />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {VIDEO_LABELS.map((opt) => (
                  <SliderRow
                    key={opt.key}
                    label={opt.label}
                    value={video[opt.key] as number}
                    min={opt.min}
                    max={opt.max}
                    step={opt.step}
                    onChange={(v) => setVideoFilter(opt.key, v)}
                    format={(v) => {
                      if (opt.key === "hueRotate") return `${v}°`;
                      if (opt.key === "blur") return v.toFixed(1);
                      return `${Math.round(v)}%`;
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Audio column */}
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text">Audio</span>
                <div className="w-28">
                  <PresetSelect presets={AUDIO_PRESET_NAMES} value={audioPreset} onChange={applyAudioPreset} />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {BAND_FREQUENCIES.map((freq, i) => (
                  <SliderRow
                    key={freq}
                    label={fmtHz(freq)}
                    value={audio[i]}
                    min={-12}
                    max={12}
                    step={1}
                    onChange={(v) => setAudioBand(i, v)}
                    format={(v) => `${v > 0 ? "+" : ""}${v}dB`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
