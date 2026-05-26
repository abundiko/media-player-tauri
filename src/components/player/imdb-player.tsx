import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Select,
  Label,
  Button,
  SelectValue,
  Popover,
  ListBox,
  ListBoxItem,
} from "react-aria-components";

interface Provider {
  name: string;
  url: (id: string) => string;
}

const PROVIDERS: Provider[] = [
  {
    name: "2embed",
    url: (id) => `https://www.2embed.cc/embed/${id}`,
  },
  {
    name: "vidsrc",
    url: (id) => `https://vidsrc.to/embed/movie/${id}`,
  },
  {
    name: "vsembed",
    url: (id) => `https://vsembed.ru/embed/movie?imdb=${id}`,
  },
];

const LOAD_TIMEOUT_MS = 20_000;

export function ImdbPlayer() {
  const { imdbId } = useParams<{ imdbId: string }>();
  const navigate = useNavigate();

  const [providerIndex, setProviderIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeKey, setIframeKey] = useState(0);

  const currentProvider = PROVIDERS[providerIndex];

  const startTimeout = useCallback(() => {
    setTimedOut(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setTimedOut(true);
    }, LOAD_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    startTimeout();
    setReady(false);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [providerIndex, startTimeout]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate("/");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  const handleLoad = () => {
    setReady(true);
    setTimedOut(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };

  const handleSelectionChange = (key: string) => {
    const idx = Number(key);
    setProviderIndex(idx);
    setIframeKey((k) => k + 1);
  };

  if (!imdbId) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black">
        <p className="text-sm text-white/50">Invalid IMDb URL</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col bg-black">
      <div className="relative flex flex-1">
        <iframe
          ref={iframeRef}
          key={`${providerIndex}-${iframeKey}-${imdbId}`}
          src={currentProvider.url(imdbId)}
          title="IMDb movie player"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
          onLoad={handleLoad}
        />

        {!ready && !timedOut && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
          </div>
        )}
      </div>

      <div className="flex items-center justify-center border-t border-white/10 px-4 py-2">
        <Select
          selectedKey={String(providerIndex)}
          onSelectionChange={(key) => handleSelectionChange(key as string)}
          className="flex items-center gap-2"
        >
          <Label className="text-xs text-white/40">Provider</Label>
          <Button className="flex cursor-pointer items-center gap-1 rounded-md border border-border bg-white/5 px-2.5 py-1 text-xs text-white/60 outline-none transition-colors hover:border-white/30 hover:text-white/80">
            <SelectValue />
          </Button>
          <Popover className="overflow-hidden rounded-lg border border-border shadow-lg backdrop-blur-xl">
            <ListBox
              className="py-1 outline-none"
              style={{ background: "var(--surface-alt)" }}
            >
              {PROVIDERS.map((p, i) => (
                <ListBoxItem
                  id={String(i)}
                  key={p.name}
                  textValue={p.name}
                  className="flex cursor-pointer items-center px-3 py-1.5 text-xs text-text-muted outline-none transition-colors hover:bg-surface-hover selected:text-cyan-400"
                >
                  {p.name}
                </ListBoxItem>
              ))}
            </ListBox>
          </Popover>
        </Select>
      </div>
    </div>
  );
}
