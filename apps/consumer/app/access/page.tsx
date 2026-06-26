"use client";

import { Suspense, useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";

// ── Confetti ────────────────────────────────────────────────────
const CONFETTI_COLORS = ["#4a9e3f","#2d5a27","#a8c89e","#c4a962","#7ab876","#e8f0e4","#ffffff","#d4edca"];
interface Particle { x:number; y:number; size:number; color:string; rotation:number; rotationSpeed:number; speedX:number; speedY:number; opacity:number; isRect:boolean; }

// ── Sample resume text ──────────────────────────────────────────
const SAMPLE_RESUME = `James "Jimmy" Wallace
Milwaukee WI  |  414-555-0187  |  jimmywallace82@email.com

OBJECTIVE
Looking for a cooking job or kitchen job where I can work hard and show up
everyday. I have experience cooking, prepping food, dishwashing, cleaning,
working grill, and helping in busy kitchens. I am trying to get stable work
and do better.

WORK EXPERIENCE

Cook / Prep Cook
Main Street Family Diner -- Milwaukee, WI
March 2023 -- November 2023
  Cooked breakfast and lunch food
  Used grill, fryer, flat top, oven
  Cut vegetables and prepped food
  Cleaned kitchen and dishes
  Helped unload food truck sometimes
  Left because hours got cut

Kitchen Worker
Wisconsin Correctional Center
2019 -- 2022
  Worked in kitchen while incarcerated
  Prepared trays for many people
  Washed dishes and cleaned food areas
  Helped with breakfast and dinner
  Learned food safety and sanitation
  Did what supervisors told me to do
  Was reliable and got good reports

Cook Helper
Tony's Pizza & Wings -- Milwaukee, WI
2016 -- 2017
  Made pizzas and wings
  Used fryer and oven
  Cleaned floors and took trash out
  Prepped cheese, sauce, toppings
  Sometimes answered phones
  Stopped working due to personal issues

Dishwasher / Line Help
Lakeview Bar & Grill -- West Allis, WI
2014 -- 2015
  Washed dishes / Cleaned kitchen
  Helped cooks when busy / Stocked cooler
  Took out garbage / Did closing cleaning

SKILLS
Cooking, food prep, grill, fryer, dishwashing, cleaning, kitchen safety
Can lift heavy, work fast, follow orders -- not afraid of hard work

EDUCATION
GED -- Completed while incarcerated, 2020

CERTIFICATIONS
Food safety class / Kitchen sanitation
ServSafe -- not sure if still active

OTHER
I have had gaps in work history because of incarceration and personal
problems but I am ready to work now. I am dependable when given a chance.
Can work nights, weekends, overtime. No reliable car but can take bus
or get rides.

References available upon request`;

// ── Tools ───────────────────────────────────────────────────────
const TOOLS = [
  { name: "Job Board", desc: "Real local listings with fair-chance employer flags and AI-simplified descriptions" },
  { name: "Application Tailor", desc: "Job-targeted resume, cover letter, and disclosure -- built from Forge output, no blank-page friction" },
  { name: "Disclosure Coach", desc: "Jurisdiction-specific timing, legal rights, and a natural conversation script" },
  { name: "Interview Prep", desc: "Adaptive AI mock interviews with structured written feedback" },
  { name: "Fair-Chance Lanes", desc: "Fair-chance opportunity lanes connected to live job search, resumes, disclosure, and interview prep" },
  { name: "Application Tracker", desc: "Documented arc from intake to placement, measurable at every step" },
];

// ── Styles ──────────────────────────────────────────────────────
const S = {
  eyebrow: { fontSize:"11px", fontWeight:700, letterSpacing:"0.2em", textTransform:"uppercase" as const, color:"#a8c89e", display:"block", marginBottom:"20px" },
  sectionLabel: { fontSize:"11px", fontWeight:700, letterSpacing:"0.16em", textTransform:"uppercase" as const, color:"#4a6741", marginBottom:"12px", display:"block" },
  divider: { border:"none", borderTop:"1px solid #e8e4dc", margin:"40px 0" },
};

export default function AccessPage() {
  return (
    <Suspense>
      <AccessPageInner />
    </Suspense>
  );
}

function AccessPageInner() {
  const searchParams = useSearchParams();
  const partnerCode  = (searchParams.get("code") || "BAKER2026").toUpperCase();
  const isBaker      = partnerCode === "BAKER2026";
  // Generic partner personalization via URL-encoded query params, with the
  // Baker launch kept as the built-in default. ?name= greets the org/person in
  // the hero; ?contact= addresses the closing note by first name.
  // Greeting derives from the CODE itself so links already distributed
  // (bare ?code=X, no name param) still personalize correctly. ?name= and
  // ?contact= override the map when present.
  const PARTNER_NAMES: Record<string, string> = {
    BAKER2026: "Dr. Baker", BAKERCREW: "Dr. Baker",
    JFW2026: "Justice Forward WI", JFWCREW: "Justice Forward WI",
    EXPO2026: "EXPO of Wisconsin", EXPOCREW: "EXPO of Wisconsin",
    GUESTHOUSE2026: "Guest House of Milwaukee", GUESTHOUSECREW: "Guest House of Milwaukee",
    OFS2026: "Operation Fresh Start",
    MWOCREW: "My Way Out",
  };
  const orgName      = (searchParams.get("name") || "").trim();
  const contactName  = (searchParams.get("contact") || "").trim();
  const displayName  = orgName || PARTNER_NAMES[partnerCode] || "";
  const heroName     = displayName ? `${displayName}.` : "Welcome.";
  const closingLead  = contactName || displayName || "Friend";

  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef      = useRef<number>(0);
  const [phase, setPhase]     = useState(0);
  const [copied, setCopied]   = useState(false);

  // Carry the cohort code into pre-auth Forge requests (seats v1): the rate
  // limiter reads this cookie and counts the session against the code's shared
  // seat pool instead of the venue's single NAT IP (classrooms/labs/libraries).
  // 60 days, parent domain so forge.* and refinery.* both see it.
  useEffect(() => {
    if (!/^[A-Z0-9]{4,20}$/.test(partnerCode)) return;
    try {
      const host = window.location.hostname;
      const domain = host.endsWith("steelmanresumes.com") ? "; domain=.steelmanresumes.com" : "";
      document.cookie = `smr_access_code=${partnerCode}; path=/; max-age=${60 * 24 * 60 * 60}; SameSite=Lax${domain}`;
    } catch {}
  }, [partnerCode]);

  // Staggered content reveal
  useEffect(() => {
    const timers = [100,500,800].map((ms,i) => setTimeout(() => setPhase(i+1), ms));
    return () => timers.forEach(clearTimeout);
  }, []);

  // Confetti
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    const count = Math.min(160, Math.floor(window.innerWidth / 9));
    particlesRef.current = Array.from({ length: count }, () => ({
      x: Math.random() * window.innerWidth,
      y: -Math.random() * window.innerHeight * 1.4,
      size: 4 + Math.random() * 8,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.11,
      speedX: (Math.random() - 0.5) * 2,
      speedY: 1.6 + Math.random() * 3.2,
      opacity: 0.5 + Math.random() * 0.5,
      isRect: Math.random() > 0.45,
    }));
    const startTime = Date.now();
    const STOP_MS = 15_000;
    const FADE_MS = 2_000; // fade out over last 2s

    const draw = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= STOP_MS + FADE_MS) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const globalFade = elapsed > STOP_MS
        ? 1 - (elapsed - STOP_MS) / FADE_MS
        : 1;
      for (const p of particlesRef.current) {
        p.x += p.speedX; p.y += p.speedY; p.rotation += p.rotationSpeed;
        if (p.y > canvas.height + 20) { p.y = -20; p.x = Math.random() * canvas.width; }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rotation);
        ctx.globalAlpha = p.opacity * globalFade; ctx.fillStyle = p.color;
        if (p.isRect) ctx.fillRect(-p.size/2, -p.size/5, p.size, p.size*0.45);
        else { ctx.beginPath(); ctx.ellipse(0,0,p.size/3,p.size/5,0,0,Math.PI*2); ctx.fill(); }
        ctx.restore();
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener("resize", resize); };
  }, []);

  const copyResume = useCallback(() => {
    navigator.clipboard.writeText(SAMPLE_RESUME).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }, []);

  const fadeIn = (show: boolean, delay="0s") => ({
    opacity: show ? 1 : 0,
    transform: show ? "translateY(0)" : "translateY(16px)",
    transition: `opacity 0.7s ease ${delay}, transform 0.7s ease ${delay}`,
  });

  return (
    <div style={{ fontFamily:"-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background:"#f2efe8", minHeight:"100vh" }}>

      {/* ── HERO (full-viewport confetti section) ── */}
      <div style={{ position:"relative", minHeight:"100vh", background:"linear-gradient(155deg,#122510 0%,#1e3d18 35%,#2d5a27 70%,#3a6e2f 100%)", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <canvas ref={canvasRef} style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:1 }} />
        <div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse 70% 60% at 50% 40%,rgba(74,158,63,0.15) 0%,transparent 70%)", pointerEvents:"none", zIndex:1 }} />

        <div style={{ position:"relative", zIndex:2, textAlign:"center", padding:"48px 24px", maxWidth:"640px", width:"100%" }}>
          <span style={{ ...S.eyebrow, ...fadeIn(phase>=1) }}>Steel Man Resumes</span>

          <h1 style={{ ...fadeIn(phase>=1,"0.1s"), fontSize:"clamp(48px,9vw,80px)", fontWeight:800, color:"#fff", lineHeight:1.05, letterSpacing:"-0.025em", margin:"0 0 20px" }}>
            You&rsquo;re In,<br/><span style={{ color:"#c8e8c0" }}>{heroName}</span>
          </h1>

          <p style={{ ...fadeIn(phase>=2), fontSize:"18px", color:"#c8ddc4", lineHeight:1.75, maxWidth:"460px", margin:"0 auto 16px", fontFamily:"Georgia, serif" }}>
            Your platform access is live. Everything below will orient you before you begin -- then a single link at the bottom takes you into the full experience.
          </p>

          <p style={{ ...fadeIn(phase>=2,"0.1s"), fontSize:"13px", color:"rgba(200,221,196,0.55)", margin:"0 auto 48px" }}>
            Scroll to explore &darr;
          </p>

          {/* scroll cue arrow */}
          <div style={{ ...fadeIn(phase>=3,"0.2s") }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ margin:"0 auto", display:"block", opacity:0.5 }}>
              <path d="M12 5v14M5 12l7 7 7-7" stroke="#a8c89e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{ maxWidth:"680px", margin:"0 auto", padding:"64px 24px 80px" }}>

        {/* ── SECTION: What You're About to Experience ── */}
        <span style={S.sectionLabel}>What You&rsquo;re About to Experience</span>
        <h2 style={{ fontSize:"28px", fontWeight:800, color:"#1c1c1a", letterSpacing:"-0.02em", margin:"0 0 20px", lineHeight:1.2 }}>
          Two tools. One arc.<br/>From raw material to readiness.
        </h2>

        <div style={{ background:"#fff", borderRadius:"16px", padding:"32px", marginBottom:"16px", border:"1px solid #e8e4dc" }}>
          <div style={{ display:"flex", gap:"16px", alignItems:"flex-start" }}>
            <div style={{ width:"36px", height:"36px", borderRadius:"50%", background:"#2d5a27", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:"16px", flexShrink:0 }}>1</div>
            <div>
              <div style={{ fontSize:"17px", fontWeight:700, color:"#1c1c1a", marginBottom:"8px" }}>The Forge &mdash; <span style={{ color:"#4a6741" }}>forge.steelmanresumes.com</span></div>
              <p style={{ fontSize:"15px", color:"#4a4a48", lineHeight:1.75, margin:0 }}>
                The public front door. No account required. The Forge reads a person&rsquo;s raw work history -- gaps, correctional facility jobs, rough language and all -- and returns a professional narrative, career paths, barrier resources, and a resume starter in about 90 seconds.
              </p>
              <div style={{ marginTop:"14px", padding:"14px 16px", background:"#f0f5ee", borderRadius:"10px", borderLeft:"3px solid #4a6741" }}>
                <p style={{ fontSize:"14px", color:"#2d5a27", fontStyle:"italic", margin:0, lineHeight:1.65 }}>
                  The design intention: give the person a credible, dignified professional identity before they have to ask for one. For a population conditioned to apologize for their work history, that reframe is the psychological precondition for everything that follows.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div style={{ background:"#fff", borderRadius:"16px", padding:"32px", marginBottom:"16px", border:"1px solid #e8e4dc" }}>
          <div style={{ display:"flex", gap:"16px", alignItems:"flex-start" }}>
            <div style={{ width:"36px", height:"36px", borderRadius:"50%", background:"#2d5a27", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:"16px", flexShrink:0 }}>2</div>
            <div>
              <div style={{ fontSize:"17px", fontWeight:700, color:"#1c1c1a", marginBottom:"8px" }}>The Refinery &mdash; <span style={{ color:"#4a6741" }}>refinery.steelmanresumes.com</span></div>
              <p style={{ fontSize:"15px", color:"#4a4a48", lineHeight:1.75, margin:0 }}>
                The authenticated workspace. Once signed in, the person builds their future here -- not receives it. Job Board, Application Tailor, Disclosure Coach, Interview Prep, Application Tracker. Every action is logged. Every step is measurable.
              </p>
            </div>
          </div>
        </div>

        <div style={{ background:"linear-gradient(135deg,#1e3d18,#2d5a27)", borderRadius:"14px", padding:"24px 28px", textAlign:"center", marginBottom:"16px" }}>
          <p style={{ fontSize:"16px", color:"#fff", lineHeight:1.8, margin:0 }}>
            <strong style={{ color:"#c8e8c0" }}>The Forge gives something to the user.</strong><br/>
            The Refinery builds something with the user.<br/>
            <span style={{ fontSize:"14px", color:"rgba(200,221,196,0.75)" }}>That arc is where the self-efficacy data lives -- and where the outcome story lives for your funders.</span>
          </p>
        </div>

        <hr style={S.divider}/>

        {/* ── SECTION: Refinery Tools ── */}
        <span style={S.sectionLabel}>What&rsquo;s Waiting in the Refinery</span>
        <h2 style={{ fontSize:"22px", fontWeight:700, color:"#1c1c1a", margin:"0 0 20px" }}>Every tool is unlocked for you from your first sign-in.</h2>

        <div style={{ background:"#fff", borderRadius:"16px", overflow:"hidden", border:"1px solid #e8e4dc", marginBottom:"16px" }}>
          {TOOLS.map((tool, i) => (
            <div key={tool.name} style={{ display:"flex", gap:"14px", padding:"16px 24px", borderBottom: i < TOOLS.length-1 ? "1px solid #f0ede6" : "none", alignItems:"flex-start" }}>
              <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:"#4a6741", marginTop:"7px", flexShrink:0 }} />
              <div>
                <div style={{ fontSize:"14px", fontWeight:700, color:"#1c1c1a", marginBottom:"3px" }}>{tool.name}</div>
                <div style={{ fontSize:"13.5px", color:"#6a6a68", lineHeight:1.55 }}>{tool.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <hr style={S.divider}/>

        {/* ── SECTION: Access Details ── */}
        <span style={S.sectionLabel}>Your Access</span>
        <h2 style={{ fontSize:"22px", fontWeight:700, color:"#1c1c1a", margin:"0 0 20px" }}>No setup required. Your email is pre-authorized.</h2>

        <div style={{ background:"#fff", borderRadius:"16px", border:"1px solid #e8e4dc", overflow:"hidden", marginBottom:"16px" }}>
          {isBaker ? (
            <div style={{ padding:"20px 24px", borderBottom:"1px solid #f0ede6" }}>
              <div style={{ fontSize:"11px", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase" as const, color:"#4a6741", marginBottom:"6px" }}>Sign-in Email</div>
              <div style={{ fontSize:"16px", fontWeight:600, color:"#1c1c1a", marginBottom:"4px" }}>latonyabakergoe@gmail.com</div>
              <div style={{ fontSize:"13px", color:"#7a7a78" }}>This address is pre-authorized. Sign in at refinery.steelmanresumes.com and you will receive a one-click magic link. Partner tier activates automatically -- no code needed.</div>
            </div>
          ) : (
            <div style={{ padding:"20px 24px", borderBottom:"1px solid #f0ede6" }}>
              <div style={{ fontSize:"11px", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase" as const, color:"#4a6741", marginBottom:"6px" }}>Sign In</div>
              <div style={{ fontSize:"14px", color:"#4a4a48", lineHeight:1.6 }}>
                Create a free account (or sign in) at <strong>forge.steelmanresumes.com</strong>, then go to Settings and enter your partner code below to unlock full access.
              </div>
            </div>
          )}
          <div style={{ padding:"20px 24px", borderBottom:"1px solid #f0ede6" }}>
            <div style={{ fontSize:"11px", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase" as const, color:"#4a6741", marginBottom:"6px" }}>Partner Code</div>
            <div style={{ fontSize:"22px", fontWeight:800, color:"#1c1c1a", letterSpacing:"0.06em", fontFamily:"monospace", marginBottom:"4px" }}>{partnerCode}</div>
            <div style={{ fontSize:"13px", color:"#7a7a78" }}>Anyone on your staff or in your program can redeem this code after creating an account to unlock partner-tier access. No expiry, no redemption limit.</div>
          </div>
          <div style={{ padding:"20px 24px" }}>
            <div style={{ fontSize:"11px", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase" as const, color:"#4a6741", marginBottom:"6px" }}>Your Tier</div>
            <div style={{ display:"inline-flex", alignItems:"center", gap:"8px", background:"#f0f5ee", border:"1px solid #b8d4b0", borderRadius:"20px", padding:"6px 14px", marginBottom:"4px" }}>
              <div style={{ width:"7px", height:"7px", borderRadius:"50%", background:"#4a6741" }} />
              <span style={{ fontSize:"13px", fontWeight:700, color:"#2d5a27" }}>Partner</span>
            </div>
            <div style={{ fontSize:"13px", color:"#7a7a78", marginTop:"6px" }}>Partner tier bypasses the standard onboarding gates -- all tools are accessible immediately. You see the full platform as it exists for your population, not just the public entry points.</div>
          </div>
        </div>

        <hr style={S.divider}/>

        {/* ── SECTION: Sample Resume ── */}
        <span style={S.sectionLabel}>Sample Resume -- Paste Into The Forge</span>
        <h2 style={{ fontSize:"22px", fontWeight:700, color:"#1c1c1a", margin:"0 0 12px" }}>No resume on hand? Use Jimmy.</h2>
        <p style={{ fontSize:"15px", color:"#4a4a48", lineHeight:1.75, marginBottom:"20px" }}>
          This is a fictional but realistic scenario from your population -- a Milwaukee kitchen worker with a correctional facility job in his history, employment gaps, and a raw objective section. Copy it, paste it into The Forge on the next page, answer a few short questions about readiness and goals, and the full output generates in about 90 seconds.
        </p>

        <div style={{ background:"#fff", border:"1.5px solid #d8d4cc", borderRadius:"14px", overflow:"hidden", marginBottom:"16px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 20px", borderBottom:"1px solid #ede9e0", background:"#fafaf8" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
              <div style={{ width:"10px", height:"10px", borderRadius:"2px", background:"#4a6741" }} />
              <span style={{ fontSize:"12px", fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase" as const, color:"#4a6741" }}>Jimmy Wallace &mdash; Sample Resume</span>
            </div>
            <button
              onClick={copyResume}
              style={{
                background: copied ? "#2d5a27" : "#fff",
                border: `1.5px solid ${copied ? "#2d5a27" : "#b8d4b0"}`,
                borderRadius:"8px",
                padding:"7px 16px",
                fontSize:"13px",
                fontWeight:600,
                color: copied ? "#fff" : "#2d5a27",
                cursor:"pointer",
                transition:"all 0.2s",
                fontFamily:"inherit",
              }}
            >
              {copied ? "Copied!" : "Copy to Clipboard"}
            </button>
          </div>
          <pre style={{ margin:0, padding:"20px 22px", fontFamily:"'Courier New', Courier, monospace", fontSize:"12px", lineHeight:1.8, color:"#2a2a2a", whiteSpace:"pre-wrap" as const, wordBreak:"break-word" as const, background:"#fafaf8", maxHeight:"340px", overflow:"auto" }}>
            {SAMPLE_RESUME}
          </pre>
        </div>

        <hr style={S.divider}/>

        {/* ── SECTION: Closing Note ── */}
        <div style={{ background:"#fff", borderRadius:"16px", padding:"32px", border:"1px solid #e8e4dc", marginBottom:"48px" }}>
          <p style={{ fontSize:"15.5px", color:"#3a3a38", lineHeight:1.85, marginBottom:"16px", fontFamily:"Georgia, serif" }}>
            {isBaker
              ? "Dr. Baker, the scholarship and organizational instinct you bring to this work -- the ability to see both the human in front of you and the systems that have failed them -- is exactly what this technology needs at the table."
              : `${closingLead}, the instinct that brings you to this work -- the ability to see both the person in front of you and the systems that have failed them -- is exactly what this technology needs at the table.`}
          </p>
          <p style={{ fontSize:"15.5px", color:"#3a3a38", lineHeight:1.85, marginBottom:"0", fontFamily:"Georgia, serif" }}>
            I built Steel Man Resumes for the person who ran a correctional kitchen for three years, earned every supervisor&rsquo;s trust, and still could not clear a background check box on a job application. Your population knows that person. What you are building makes the technology matter.
          </p>
          <div style={{ marginTop:"24px", paddingTop:"20px", borderTop:"1px solid #e8e4dc" }}>
            <div style={{ fontSize:"15px", fontWeight:700, color:"#1c1c1a" }}>Troy Richard Carr</div>
            <div style={{ fontSize:"13px", color:"#7a7a78", marginTop:"3px" }}>Steel Man Resumes &nbsp;&middot;&nbsp; The Midnight Garden LLC &nbsp;&middot;&nbsp; steelmanresumes.com</div>
          </div>
        </div>

        {/* ── CTA: Begin the Experience ── */}
        <div style={{ textAlign:"center", padding:"0 0 16px" }}>
          <div style={{ fontSize:"12px", fontWeight:600, letterSpacing:"0.12em", textTransform:"uppercase" as const, color:"#7a8c77", marginBottom:"20px" }}>
            You&rsquo;ve read the brief. Ready when you are.
          </div>
          <a
            href="https://forge.steelmanresumes.com/intro"
            style={{
              display:"inline-block",
              background:"linear-gradient(145deg,#1e3d18,#2d5a27)",
              color:"#fff",
              fontSize:"17px",
              fontWeight:700,
              padding:"18px 52px",
              borderRadius:"50px",
              textDecoration:"none",
              letterSpacing:"0.01em",
              boxShadow:"0 8px 32px rgba(45,90,39,0.38), 0 2px 8px rgba(0,0,0,0.12)",
            }}
          >
            Begin the Experience &rarr;
          </a>
          <p style={{ fontSize:"13px", color:"#9a9a98", marginTop:"14px", lineHeight:1.6 }}>
            Starts at The Forge &mdash; the same entry point your clients use.<br/>
            When you&rsquo;re ready to sign in to the Refinery, go to <a href="https://refinery.steelmanresumes.com" style={{ color:"#4a6741", textDecoration:"none", fontWeight:600 }}>refinery.steelmanresumes.com</a>.
          </p>
        </div>

      </div>
    </div>
  );
}
