"use client";

import { useEffect, useRef, useState } from "react";

const CONFETTI_COLORS = [
  "#4a9e3f", "#2d5a27", "#a8c89e", "#c4a962",
  "#7ab876", "#e8f0e4", "#ffffff", "#d4edca",
];

const TOOLS = [
  { name: "Job Board", desc: "Real listings, fair-chance flagged" },
  { name: "Resume Builder", desc: "Job-targeted from your Forge output" },
  { name: "Disclosure Coach", desc: "Jurisdiction-specific scripts + rights" },
  { name: "Interview Prep", desc: "Adaptive AI mock interviews" },
  { name: "Resources", desc: "Barrier-matched navigation" },
  { name: "Application Tracker", desc: "Full arc, intake to offer" },
];

interface Particle {
  x: number; y: number;
  size: number; color: string;
  rotation: number; rotationSpeed: number;
  speedX: number; speedY: number;
  opacity: number; isRect: boolean;
}

export default function AccessPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 100);
    const t2 = setTimeout(() => setPhase(2), 500);
    const t3 = setTimeout(() => setPhase(3), 900);
    const t4 = setTimeout(() => setPhase(4), 1200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const count = Math.min(180, Math.floor(window.innerWidth / 8));
    particlesRef.current = Array.from({ length: count }, () => ({
      x: Math.random() * window.innerWidth,
      y: -Math.random() * window.innerHeight * 1.2,
      size: 5 + Math.random() * 9,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.12,
      speedX: (Math.random() - 0.5) * 2.2,
      speedY: 1.8 + Math.random() * 3.5,
      opacity: 0.55 + Math.random() * 0.45,
      isRect: Math.random() > 0.4,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particlesRef.current) {
        p.x += p.speedX;
        p.y += p.speedY;
        p.rotation += p.rotationSpeed;
        if (p.y > canvas.height + 20) {
          p.y = -20;
          p.x = Math.random() * canvas.width;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        if (p.isRect) {
          ctx.fillRect(-p.size / 2, -p.size / 5, p.size, p.size * 0.45);
        } else {
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size / 3, p.size / 5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const fade = (threshold: number, delay = "0s") => ({
    opacity: phase >= threshold ? 1 : 0,
    transform: phase >= threshold ? "translateY(0px)" : "translateY(18px)",
    transition: `opacity 0.75s ease ${delay}, transform 0.75s ease ${delay}`,
  });

  return (
    <div style={{
      position: "relative",
      minHeight: "100vh",
      background: "linear-gradient(155deg, #122510 0%, #1e3d18 35%, #2d5a27 70%, #3a6e2f 100%)",
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1 }} />
      <div style={{
        position: "absolute", inset: 0, zIndex: 1,
        background: "radial-gradient(ellipse 70% 60% at 50% 40%, rgba(74,158,63,0.18) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      <div style={{ position: "relative", zIndex: 2, textAlign: "center", padding: "48px 24px 64px", maxWidth: "680px", width: "100%" }}>

        <div style={{ ...fade(1), display: "inline-block", fontSize: "11px", fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase" as const, color: "#a8c89e", marginBottom: "28px" }}>
          Steel Man Resumes
        </div>

        <h1 style={{
          ...fade(1, "0.1s"),
          fontSize: "clamp(44px, 9vw, 78px)",
          fontWeight: 800, color: "#ffffff",
          lineHeight: 1.05, letterSpacing: "-0.025em",
          margin: "0 0 20px",
        }}>
          You&rsquo;re In,<br />
          <span style={{ color: "#c8e8c0" }}>Dr. Baker.</span>
        </h1>

        <p style={{
          ...fade(2),
          fontSize: "18px", color: "#c8ddc4",
          lineHeight: 1.75, maxWidth: "480px",
          margin: "0 auto 44px",
          fontFamily: "Georgia, serif",
        }}>
          Your platform access is live. Every tool in the Refinery is unlocked and waiting for you.
        </p>

        <div style={{ ...fade(2, "0.15s"), marginBottom: "52px" }}>
          <a
            href="https://refinery.steelmanresumes.com"
            style={{
              display: "inline-block",
              background: "#ffffff",
              color: "#1a3816",
              fontSize: "16px", fontWeight: 700,
              padding: "16px 44px",
              borderRadius: "50px",
              textDecoration: "none",
              letterSpacing: "0.01em",
              boxShadow: "0 6px 28px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.15)",
            }}
          >
            Open the Refinery &rarr;
          </a>
        </div>

        <div style={{ ...fade(3), fontSize: "11px", fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase" as const, color: "#6a9e62", marginBottom: "20px" }}>
          Everything unlocked for you
        </div>

        <div style={{ ...fade(3, "0.05s"), display: "flex", flexWrap: "wrap" as const, gap: "10px", justifyContent: "center", marginBottom: "52px" }}>
          {TOOLS.map((tool, i) => (
            <div key={tool.name} style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: "10px",
              padding: "10px 16px",
              textAlign: "left" as const,
              minWidth: "180px", maxWidth: "220px",
              opacity: phase >= 3 ? 1 : 0,
              transform: phase >= 3 ? "translateY(0)" : "translateY(12px)",
              transition: `opacity 0.6s ease ${0.05 + i * 0.08}s, transform 0.6s ease ${0.05 + i * 0.08}s`,
            }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#e8f4e4", marginBottom: "3px" }}>{tool.name}</div>
              <div style={{ fontSize: "12px", color: "#8ab884", lineHeight: 1.4 }}>{tool.desc}</div>
            </div>
          ))}
        </div>

        <div style={{ ...fade(4), borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "32px" }}>
          <p style={{
            fontSize: "14px", color: "rgba(200,221,196,0.65)",
            lineHeight: 1.7, fontFamily: "Georgia, serif",
            fontStyle: "italic", maxWidth: "440px",
            margin: "0 auto 16px",
          }}>
            This is the beginning of the Steel Man Resumes experience &mdash; built for every person who deserves to see themselves this way.
          </p>
          <div style={{ fontSize: "12px", color: "rgba(168,200,158,0.5)", letterSpacing: "0.05em" }}>
            steelmanresumes.com &nbsp;&middot;&nbsp; The Midnight Garden LLC
          </div>
        </div>

      </div>
    </div>
  );
}
