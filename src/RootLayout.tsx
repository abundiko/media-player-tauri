import { useState, useEffect, useRef } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { usePlayerStore } from "./stores/player";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { isMediaFile } from "./components/drop-zone";
import { DragOverlay } from "./components/drag-overlay";
import { ErrorModal } from "./components/error-modal";
import { TitleBar } from "./components/title-bar";

export function RootLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const filePath = usePlayerStore((s) => s.filePath);
  const loadFile = usePlayerStore((s) => s.loadFile);
  const [dragging, setDragging] = useState(false);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const listenerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (filePath && location.pathname !== "/player/video") {
      navigate("/player/video");
    } else if (!filePath && location.pathname !== "/" && !location.pathname.startsWith("/player/youtube/") && !location.pathname.startsWith("/player/imdb/")) {
      navigate("/");
    }
  }, [filePath, navigate, location.pathname]);

  useEffect(() => {
    let cancelled = false;

    const checkStartupFile = async () => {
      try {
        const file = await invoke<string | null>("get_startup_file");
        if (file && !cancelled) {
          console.log("[startup] Found file from args:", file);
          loadFile(file);
        }
      } catch (e) {
        console.error("[startup] Failed to get startup file:", e);
      }
    };

    checkStartupFile();

    const setup = async () => {
      try {
        const unlistenDrag = await getCurrentWindow().onDragDropEvent((event) => {
          const payload = event.payload;

          switch (payload.type) {
            case "enter":
              console.log("[drag] Tauri drag-enter, paths:", payload.paths);
              setDragging(true);
              break;
            case "over":
              setDragging(true);
              break;
            case "leave":
              console.log("[drag] Tauri drag-leave");
              setDragging(false);
              break;
            case "drop": {
              setDragging(false);
              console.log("[drag] Tauri drop, paths:", payload.paths);
              if (payload.paths.length > 0) {
                console.log("[drag] file:", payload.paths[0]);
                if (isMediaFile(payload.paths[0])) {
                  console.log("[drag] loading file:", payload.paths[0]);
                  loadFile(payload.paths[0]);
                } else {
                  console.log("[drag] unsupported format, showing error modal");
                  setErrorModalOpen(true);
                }
              }
              break;
            }
          }
        });

        const { listen } = await import("@tauri-apps/api/event");
        const unlistenFileOpened = await listen<string>("file-opened", (event) => {
          console.log("[startup] Received file-opened event:", event.payload);
          if (isMediaFile(event.payload)) {
            loadFile(event.payload);
          } else {
            setErrorModalOpen(true);
          }
        });

        if (cancelled) {
          unlistenDrag();
          unlistenFileOpened();
          return;
        }

        if (listenerRef.current) {
          listenerRef.current();
        }
        listenerRef.current = () => {
          unlistenDrag();
          unlistenFileOpened();
        };
        console.log("[drag] Tauri listeners registered");
      } catch (e) {
        if (!cancelled) {
          console.error("[drag] failed to setup Tauri listeners:", e);
        }
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (listenerRef.current) {
        listenerRef.current();
        listenerRef.current = null;
        console.log("[drag] Tauri listeners removed");
      }
    };
  }, [loadFile]);

  // Hide border/rounded corners when window is maximized
  useEffect(() => {
    const appWindow = getCurrentWindow();
    const rootEl = document.getElementById("root");

    const updateMaximized = async () => {
      const m = await appWindow.isMaximized();
      if (rootEl) {
        rootEl.classList.toggle("maximized", m);
      }
    };

    updateMaximized();

    let cancelled = false;
    const setup = async () => {
      const unlisten = await appWindow.onResized(async () => {
        if (cancelled) return;
        await updateMaximized();
      });
      if (!cancelled) return unlisten;
      unlisten();
    };

    const unlistenPromise = setup();
    return () => {
      cancelled = true;
      unlistenPromise.then((u) => u?.());
    };
  }, []);

  // Prevent standard web navigation to make the app feel like a desktop app
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab" || e.key === "F12") return;
      if (e.ctrlKey || e.metaKey) return;
      const navKeys = [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
        "PageUp",
        "PageDown",
      ];
      if (navKeys.includes(e.key) || e.key === " ") {
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
      className="flex h-full w-full flex-col"
    >
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Outlet />
      </div>
      <DragOverlay dragging={dragging} />
      <ErrorModal isOpen={errorModalOpen} onOpenChange={setErrorModalOpen} />
    </div>
  );
}
