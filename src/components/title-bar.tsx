import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LuMinimize, LuMaximize, LuMinimize2, LuX, LuChevronLeft, LuPin } from "react-icons/lu";
import { useTheme } from "../hooks/use-theme";
import { LuSun, LuMoon } from "react-icons/lu";
import { usePlayerStore } from "../stores/player";

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [pinned, setPinned] = useState(false);
  const appWindow = getCurrentWindow();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const showBack = location.pathname !== "/";
  const showPin = location.pathname.startsWith("/player/");

  useEffect(() => {
    appWindow.isMaximized().then(setMaximized);

    let cancelled = false;
    const setup = async () => {
      const unlisten = await appWindow.onResized(async () => {
        const m = await appWindow.isMaximized();
        if (!cancelled) setMaximized(m);
      });
      if (cancelled) {
        unlisten();
        return;
      }
      return unlisten;
    };

    const unlistenPromise = setup();
    return () => {
      cancelled = true;
      unlistenPromise.then((u) => u?.());
    };
  }, [appWindow]);

  // Unpin when navigating away from the player page
  useEffect(() => {
    if (!location.pathname.startsWith("/player/")) {
      appWindow.setAlwaysOnTop(false);
      setPinned(false);
    }
  }, [location.pathname, appWindow]);

  return (
    <div
      data-tauri-drag-region
      className="relative z-60 flex h-9 shrink-0 items-center justify-between border-b border-border bg-surface px-3 select-none"
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-text-muted">Caste</span>
        {showBack && (
          <button
            type="button"
            onClick={() => {
              usePlayerStore.getState().close();
              navigate("/");
            }}
            className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <LuChevronLeft size={14} />
            Back
          </button>
        )}
      </div>

      <div className="flex items-center gap-1" data-tauri-drag-region="false">
        <button
          type="button"
          onClick={toggle}
          aria-label="Toggle theme"
          className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          {theme === "dark" ? <LuSun size={12} /> : <LuMoon size={12} />}
        </button>

        {showPin && (
          <button
            type="button"
            onClick={() => {
              const next = !pinned;
              appWindow.setAlwaysOnTop(next);
              setPinned(next);
            }}
            aria-label={pinned ? "Unpin window" : "Keep window on top"}
            className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
              pinned
                ? "bg-primary/20 text-primary hover:bg-primary/30"
                : "text-text-muted hover:bg-surface-hover hover:text-text"
            }`}
          >
            {pinned ? (
              <svg viewBox="0 0 24 24" width={12} height={12} fill="currentColor">
                <path d="M16 2H8a1 1 0 0 0-1 1v4L4.2 11.1c-.4.6 0 1.4.8 1.4h14c.8 0 1.2-.8.8-1.4L17 7V3a1 1 0 0 0-1-1z" />
                <rect x="10" y="14" width="4" height="7" rx="1" />
              </svg>
            ) : (
              <LuPin size={12} />
            )}
          </button>
        )}

        <div className="mx-1 h-4 w-px bg-border" />

        <button
          type="button"
          onClick={() => appWindow.minimize()}
          aria-label="Minimize"
          className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <LuMinimize size={12} />
        </button>
        <button
          type="button"
          onClick={() => appWindow.toggleMaximize()}
          aria-label={maximized ? "Restore" : "Maximize"}
          className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          {maximized ? <LuMinimize2 size={12} /> : <LuMaximize size={12} />}
        </button>
        <button
          type="button"
          onClick={() => appWindow.close()}
          aria-label="Close"
          className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-red-500/20 hover:text-red-500"
        >
          <LuX size={14} />
        </button>
      </div>
    </div>
  );
}
