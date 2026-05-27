import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { LuSend, LuX } from "react-icons/lu";
import { useNavigate } from "react-router-dom";
import { usePlayerStore } from "../stores/player";

interface SiteDetector {
  name: string;
  match: (url: string) => boolean;
  badgeClass: string;
  handle?: (url: string) => void;
}

function extractYoutubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractImdbId(url: string): string | null {
  const patterns = [
    /imdb\.com\/title\/(tt\d{7,8})/,
    /^(tt\d{7,8})$/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

const SITE_DETECTORS: SiteDetector[] = [
  {
    name: "youtube",
    match: (url) => /(?:youtube\.com|youtu\.be)/.test(url),
    badgeClass: "bg-red-600 text-white",
  },
  {
    name: "imdb",
    match: (url) => /imdb\.com/.test(url),
    badgeClass: "bg-yellow-500 text-black",
  },
];

const URL_REGEX =
  /^https?:\/\/.+\..+/i;

function detectSite(url: string): SiteDetector | null {
  for (const d of SITE_DETECTORS) {
    if (d.match(url)) return d;
  }
  return null;
}

interface WebUrlModalProps {
  onClose: () => void;
}

export function WebUrlModal({ onClose }: WebUrlModalProps) {
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const loadFile = usePlayerStore((s) => s.loadFile);
  const navigate = useNavigate();

  const isValid = useMemo(() => URL_REGEX.test(url.trim()), [url]);

  const site = useMemo(() => {
    const trimmed = url.trim();
    if (!trimmed) return null;
    return detectSite(trimmed);
  }, [url]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = () => {
    if (!isValid) return;

    const trimmed = url.trim();

    if (site?.name === "youtube") {
      const id = extractYoutubeId(trimmed);
      if (id) {
        navigate(`/player/youtube/${id}`);
        onClose();
      }
      return;
    }

    if (site?.name === "imdb") {
      const id = extractImdbId(trimmed);
      if (id) {
        navigate(`/player/imdb/${id}`);
        onClose();
      }
      return;
    }

    loadFile(trimmed);
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      >
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />

        <motion.div
          className="relative flex w-full max-w-lg flex-col rounded-2xl border border-border bg-surface-alt shadow-2xl backdrop-blur-xl"
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
        >
          {/* header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-lg font-semibold text-text">
              Enter URL
            </h2>
            <button
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-text-muted transition-colors hover:bg-red-500/20 hover:text-red-400"
              onClick={onClose}
            >
              <LuX size={16} />
            </button>
          </div>

          {/* body */}
          <div className="flex flex-col gap-4 p-5">
            {/* input row */}
            <div className="relative">
              <input
                ref={inputRef}
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && isValid) handleSubmit();
                }}
                placeholder="https://example.com/video.mp4"
                className="w-full rounded-xl border border-border bg-surface-alt px-4 py-3 pr-20 text-sm text-text outline-none transition-colors placeholder:text-text-muted/50 focus:border-text"
              />
              {site && (
                <span
                  className={`absolute right-3 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${site.badgeClass}`}
                >
                  {site.name}
                </span>
              )}
            </div>

            {site?.name === "youtube" && (
              <p className="text-xs text-text-muted/70">
                Will open as a YouTube embed.
              </p>
            )}
            {site?.name === "imdb" && (
              <p className="text-xs text-text-muted/70">
                Will open as an IMDb embed (2embed / vidsrc).
              </p>
            )}

            {/* send button */}
            <button
              type="button"
              disabled={!isValid}
              onClick={handleSubmit}
              className={`flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-all ${
                isValid
                  ? "cursor-pointer bg-text text-surface hover:opacity-90"
                  : "cursor-not-allowed bg-surface-alt text-text-muted/40"
              }`}
            >
              <LuSend size={15} />
              {site?.name === "youtube" ? "Open YouTube" : site?.name === "imdb" ? "Open IMDb" : "Open URL"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
