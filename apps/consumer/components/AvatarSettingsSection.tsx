"use client";

/**
 * Phase 7.7 -- Settings -> Account -> Your picture.
 *
 * Two paths, one section:
 *  1. Illustrated avatar (the zero-PII DEFAULT): a small deterministic mark built
 *     from shape/color/accent/initial, saved as a CHOICE (not an image) to
 *     users.ui_avatar. No photo, no upload, no R2.
 *  2. Photo path (optional): the user picks an image; the browser crops it to a
 *     square and compresses it (<canvas>, max 512px) BEFORE upload -- no server
 *     image library. The photo is stored ENCRYPTED (owner-only) and shown through
 *     an owner-exclusive proxy. Uploaded photos + any generated headshots appear
 *     in a compare grid; each is selectable as the avatar, and the original is
 *     always retained. A photo is NEVER automatically added to a resume.
 *
 * AI headshot generation is provider-gated: when it is not turned on, the control
 * is shown as a plain "not available yet" note (never a broken button).
 *
 * Saving/selecting dispatches UI_PREFS_EVENT so the nav avatar updates without a
 * reload.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { TBtn } from "@crucible/consumer-ui";
import { IllustratedAvatar, AVATAR_FILLS } from "@/components/IllustratedAvatar";
import { UI_PREFS_EVENT } from "@/lib/ui-prefs-apply";
import {
  AVATAR_SHAPES,
  AVATAR_COLORS,
  AVATAR_ACCENTS,
  type AvatarChoice,
  type AvatarShape,
  type AvatarColor,
  type AvatarAccent,
  type UiPrefs,
} from "@crucible/core/src/uiPrefsShared";

const SHAPE_LABELS: Record<AvatarShape, string> = {
  circle: "Circle",
  square: "Rounded",
  hex: "Hex",
  shield: "Shield",
};
const ACCENT_LABELS: Record<AvatarAccent, string> = {
  solid: "Plain",
  ring: "Ring",
  corner: "Dot",
};

const MAX_DIM = 512; // client crop/compress target square edge

interface AvatarAssetView {
  id: string;
  kind: "original_photo" | "generated_headshot";
  source_asset_id: string | null;
  mime_type: string;
  byte_size: number;
  created_at: string;
  imageUrl: string;
}

export function AvatarSettingsSection() {
  const { data: session } = useSession();
  const fallbackInitial = (session?.user?.name || session?.user?.email || "?")
    .trim()
    .charAt(0)
    .toUpperCase();

  const [choice, setChoice] = useState<AvatarChoice>({
    shape: "circle",
    color: "slate",
    accent: "solid",
    initial: "",
    photoAssetId: null,
  });
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [assets, setAssets] = useState<AvatarAssetView[]>([]);
  const [genEnabled, setGenEnabled] = useState(false);
  const [genRemaining, setGenRemaining] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refreshAssets = useCallback(async () => {
    try {
      const r = await fetch("/api/avatar/assets");
      if (r.ok) {
        const j = await r.json();
        setAssets((j?.data ?? []) as AvatarAssetView[]);
      }
    } catch {
      /* leave assets as-is */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/user/ui-prefs").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/avatar/assets").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/avatar/generate").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([prefs, assetList, gen]) => {
      if (cancelled) return;
      const av = prefs?.data?.avatar as AvatarChoice | null | undefined;
      if (av) {
        setChoice({
          shape: av.shape,
          color: av.color,
          accent: av.accent,
          initial: av.initial,
          photoAssetId: av.photoAssetId ?? null,
        });
        setSelectedPhotoId(av.photoAssetId ?? null);
      }
      if (assetList?.data) setAssets(assetList.data as AvatarAssetView[]);
      if (gen?.data) {
        setGenEnabled(Boolean(gen.data.enabled));
        setGenRemaining(
          typeof gen.data.remaining === "number" ? gen.data.remaining : null
        );
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function update<K extends keyof AvatarChoice>(key: K, value: AvatarChoice[K]) {
    setChoice((prev) => ({ ...prev, [key]: value }));
    setStatus("idle");
  }

  function dispatchPrefs(prefs: UiPrefs) {
    window.dispatchEvent(new CustomEvent(UI_PREFS_EVENT, { detail: prefs }));
  }

  // --- Illustrated: save the choice (does not touch the photo pointer) --------
  async function saveIllustrated() {
    setStatus("saving");
    const toSave: AvatarChoice = {
      ...choice,
      initial: choice.initial || fallbackInitial,
    };
    try {
      const res = await fetch("/api/user/ui-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: toSave }),
      });
      if (res.ok) {
        const j = await res.json().catch(() => null);
        setStatus("saved");
        if (j?.data) dispatchPrefs(j.data as UiPrefs);
        setTimeout(() => setStatus("idle"), 2500);
      } else {
        setStatus("idle");
      }
    } catch {
      setStatus("idle");
    }
  }

  // --- Photo: client-side crop-to-square + compress, then upload --------------
  async function onPickFile(file: File) {
    setMsg(null);
    setBusy(true);
    try {
      const blob = await cropSquareCompress(file);
      const fd = new FormData();
      fd.append("file", blob, "avatar.jpg");
      fd.append("width", String(MAX_DIM));
      fd.append("height", String(MAX_DIM));
      const res = await fetch("/api/avatar/photo", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setMsg(j?.error || "Could not upload that photo.");
        return;
      }
      await refreshAssets();
      setMsg("Photo uploaded. Choose it below to use it.");
    } catch {
      setMsg("Could not read that image. Try a JPG, PNG, or WebP.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function selectPhoto(assetId: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/avatar/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "photo", assetId }),
      });
      if (res.ok) {
        const j = await res.json().catch(() => null);
        setSelectedPhotoId(assetId);
        if (j?.data) dispatchPrefs(j.data as UiPrefs);
      } else {
        setMsg("Could not use that photo.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function useIllustrated() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/avatar/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "illustrated" }),
      });
      if (res.ok) {
        const j = await res.json().catch(() => null);
        setSelectedPhotoId(null);
        if (j?.data) dispatchPrefs(j.data as UiPrefs);
      }
    } finally {
      setBusy(false);
    }
  }

  async function deleteAsset(assetId: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/avatar/${assetId}`, { method: "DELETE" });
      if (res.ok) {
        const j = await res.json().catch(() => null);
        if (j?.selectionReset) {
          setSelectedPhotoId(null);
          // Reflect the reset in the nav immediately.
          const prefs = await fetch("/api/user/ui-prefs").then((r) => (r.ok ? r.json() : null)).catch(() => null);
          if (prefs?.data) dispatchPrefs(prefs.data as UiPrefs);
        }
        await refreshAssets();
      } else {
        setMsg("Could not remove that photo.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function generateHeadshot(sourceAssetId: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/avatar/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceAssetId }),
      });
      const j = await res.json().catch(() => null);
      if (res.ok) {
        await refreshAssets();
        setMsg("Headshot generated. Choose it below to use it.");
        if (typeof j?.data?.remaining === "number") setGenRemaining(j.data.remaining);
      } else {
        setMsg(j?.message || "AI headshot generation is not available right now.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  const originals = assets.filter((a) => a.kind === "original_photo");
  const usingPhoto = selectedPhotoId != null;

  return (
    <div className="bg-t-panel p-5 border border-t-line mt-4">
      <h3 className="font-semibold text-t-white mb-1">Your picture</h3>
      <p className="text-sm text-t-phos-dim mb-4">
        Use a simple drawing or a photo for your account. This picture is only for
        your account. It is never automatically added to your resume.
      </p>

      {/* ---- Illustrated builder ---- */}
      <div className="flex items-start gap-5">
        <IllustratedAvatar
          choice={choice}
          fallbackInitial={fallbackInitial}
          size={72}
          className="flex-shrink-0"
        />

        <div className="flex-1 space-y-4">
          <div>
            <label className="text-xs text-t-phos-dim uppercase block mb-2">Shape</label>
            <div className="flex flex-wrap gap-2">
              {AVATAR_SHAPES.map((s) => (
                <Pill key={s} label={SHAPE_LABELS[s]} selected={choice.shape === s} onClick={() => update("shape", s as AvatarShape)} />
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-t-phos-dim uppercase block mb-2">Color</label>
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={choice.color === c}
                  onClick={() => update("color", c as AvatarColor)}
                  className={`t-focus h-9 w-9 rounded-full border-2 transition-transform ${
                    choice.color === c ? "border-t-amber scale-110" : "border-t-line"
                  }`}
                  style={{ backgroundColor: AVATAR_FILLS[c].bg }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-t-phos-dim uppercase block mb-2">Accent</label>
            <div className="flex flex-wrap gap-2">
              {AVATAR_ACCENTS.map((a) => (
                <Pill key={a} label={ACCENT_LABELS[a]} selected={choice.accent === a} onClick={() => update("accent", a as AvatarAccent)} />
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-t-phos-dim uppercase block mb-2">Letter</label>
            <input
              value={choice.initial}
              onChange={(e) => update("initial", e.target.value.slice(0, 1).toUpperCase())}
              placeholder={fallbackInitial}
              maxLength={1}
              className="w-16 px-3 py-2 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none transition-colors text-center"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-5">
        <TBtn onClick={saveIllustrated} disabled={status === "saving"} size="sm">
          {status === "saving" ? "saving..." : "save drawing"}
        </TBtn>
        {status === "saved" && <span className="text-sm text-t-amber-bright">Saved.</span>}
        {usingPhoto && (
          <button
            type="button"
            onClick={useIllustrated}
            disabled={busy}
            className="t-focus text-sm text-t-phos-dim underline hover:text-t-white disabled:opacity-50"
          >
            Use this drawing instead of my photo
          </button>
        )}
      </div>

      {/* ---- Photo path ---- */}
      <div className="mt-6 pt-5 border-t border-t-line">
        <h4 className="font-semibold text-t-white mb-1">Use a photo</h4>
        <p className="text-sm text-t-phos-dim mb-3">
          Add a photo of yourself. It is cropped to a square on your device before
          it is sent, kept encrypted, and only you can open it. It is never added
          to your resume.
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f);
            }}
          />
          <TBtn
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            size="sm"
          >
            {busy ? "working..." : "upload a photo"}
          </TBtn>
        </div>

        {assets.length > 0 && (
          <div className="mt-4">
            <label className="text-xs text-t-phos-dim uppercase block mb-2">
              Your photos
            </label>
            <div className="flex flex-wrap gap-4" role="group" aria-label="Your photos">
              {assets.map((a) => {
                const active = a.id === selectedPhotoId;
                return (
                  <div key={a.id} className="flex flex-col items-center gap-2">
                    <button
                      type="button"
                      aria-pressed={active}
                      aria-label={
                        a.kind === "generated_headshot"
                          ? "Use generated headshot"
                          : "Use uploaded photo"
                      }
                      onClick={() => selectPhoto(a.id)}
                      disabled={busy}
                      className={`t-focus relative rounded-full overflow-hidden border-2 transition-transform disabled:opacity-50 ${
                        active ? "border-t-amber scale-105" : "border-t-line hover:border-t-phos-dim"
                      }`}
                      style={{ width: 72, height: 72 }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={a.imageUrl}
                        alt=""
                        width={72}
                        height={72}
                        style={{ width: 72, height: 72, objectFit: "cover", display: "block" }}
                      />
                    </button>
                    <span className="text-[11px] text-t-phos-dim">
                      {a.kind === "generated_headshot" ? "Generated" : "Uploaded"}
                      {active ? " -- in use" : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteAsset(a.id)}
                      disabled={busy}
                      className="t-focus text-[11px] text-t-phos-dim underline hover:text-t-white disabled:opacity-50"
                    >
                      remove
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ---- AI headshot generation (gated) ---- */}
        <div className="mt-5 pt-4 border-t border-t-line">
          <h4 className="font-semibold text-t-white mb-1">AI headshot</h4>
          {genEnabled ? (
            <>
              <p className="text-sm text-t-phos-dim mb-2">
                Turn one of your uploaded photos into a professional headshot. You
                can generate up to {genRemaining ?? 3} today. Your original photo
                is always kept.
              </p>
              {originals.length === 0 ? (
                <p className="text-sm text-t-phos-dim">
                  Upload a photo first, then you can generate a headshot from it.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {originals.map((o) => (
                    <TBtn
                      key={o.id}
                      onClick={() => generateHeadshot(o.id)}
                      disabled={busy || (genRemaining !== null && genRemaining <= 0)}
                      size="sm"
                    >
                      generate from this photo
                    </TBtn>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-t-phos-dim">
              AI headshot generation is not available yet.
            </p>
          )}
        </div>

        <p className="sr-only" role="status" aria-live="polite">
          {msg ?? ""}
        </p>
        {msg && <p className="text-sm text-t-amber-bright mt-3">{msg}</p>}
      </div>
    </div>
  );
}

/**
 * Read an image File, center-crop to a square, downscale to MAX_DIM, and export
 * a compressed JPEG Blob. All in the browser -- no bytes leave the device until
 * upload, and the server never runs an image library. Falls back to rejecting if
 * the image cannot be decoded.
 */
function cropSquareCompress(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      if (!side) {
        reject(new Error("empty image"));
        return;
      }
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const target = Math.min(MAX_DIM, side);
      const canvas = document.createElement("canvas");
      canvas.width = target;
      canvas.height = target;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no canvas context"));
        return;
      }
      ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("encode failed"));
        },
        "image/jpeg",
        0.85
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

function Pill({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`t-focus border px-3 py-2 text-sm font-medium transition-colors ${
        selected
          ? "border-t-amber bg-t-panel-2 text-t-amber-bright"
          : "border-t-line bg-t-panel text-t-phos-dim hover:border-t-phos-dim"
      }`}
    >
      {label}
    </button>
  );
}
