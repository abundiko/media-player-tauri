import { useEffect, useRef } from "react";

interface Blob {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
}

const COLORS = [
  "rgba(0, 255, 255, 0.7)",
  "rgba(255, 105, 180, 0.7)",
  "rgba(180, 80, 255, 0.7)",
  "rgba(255, 255, 0, 0.6)",
  "rgba(50, 230, 120, 0.6)",
  "rgba(255, 100, 50, 0.5)",
];

export function AnimatedBackground({ playing = false }: { playing?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = window.innerWidth;
    let h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;

    const blobs: Blob[] = Array.from({ length: 7 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.8,
      vy: (Math.random() - 0.5) * 0.8,
      size: 250 + Math.random() * 300,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));

    let raf: number;
    let prev = performance.now();

    function draw(now: number) {
      const dt = Math.min((now - prev) / 16.67, 3);
      prev = now;

      ctx!.clearRect(0, 0, w, h);

      for (const b of blobs) {
        if (!playingRef.current) {
          b.x += b.vx * dt;
          b.y += b.vy * dt;
        }

        if (b.x < -b.size) b.x = w + b.size;
        if (b.x > w + b.size) b.x = -b.size;
        if (b.y < -b.size) b.y = h + b.size;
        if (b.y > h + b.size) b.y = -b.size;

        const grad = ctx!.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.size);
        grad.addColorStop(0, b.color);
        grad.addColorStop(1, "transparent");
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(b.x, b.y, b.size, 0, Math.PI * 2);
        ctx!.fill();
      }

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);

    const onResize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w;
      canvas.height = h;
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div className="absolute inset-0 backdrop-blur-2xl" />
    </div>
  );
}
