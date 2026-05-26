import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LuMinimize, LuMaximize, LuMinimize2, LuX, LuChevronLeft } from "react-icons/lu";
import { useTheme } from "../hooks/use-theme";
import { LuSun, LuMoon } from "react-icons/lu";
import { usePlayerStore } from "../stores/player";

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const appWindow = getCurrentWindow();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const showBack = location.pathname !== "/";

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
