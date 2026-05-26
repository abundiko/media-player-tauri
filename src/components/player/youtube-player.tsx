import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

export function YoutubePlayer() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate("/");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  if (!videoId) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black">
        <p className="text-sm text-white/50">Invalid YouTube URL</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full bg-black">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
        title="YouTube video player"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="h-full w-full"
        onLoad={() => setReady(true)}
      />

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
        </div>
      )}
    </div>
  );
}
