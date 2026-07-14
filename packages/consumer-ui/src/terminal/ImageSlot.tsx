interface ImageSlotProps {
  /** Asset ID from SMR-IMAGE-BRIEF-FOR-CHATGPT-2026-07-07.md, e.g. "IMG-01". */
  assetId: string;
  alt: string;
  src?: string;
  aspect?: string;
  className?: string;
}

/**
 * Placeholder-aware hero/supporting image. Ships pages before Troy delivers
 * the dither/duotone art -- drop in `src` later with zero layout change.
 */
export function ImageSlot({
  assetId,
  alt,
  src,
  aspect = "aspect-video",
  className = "",
}: ImageSlotProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className={`w-full ${aspect} border border-t-line object-cover ${className}`}
      />
    );
  }

  return (
    <div
      className={`flex w-full ${aspect} flex-col items-center justify-center gap-2 border border-t-line bg-t-panel px-6 text-center ${className}`}
      role="img"
      aria-label={alt}
    >
      <span className="font-term text-xs uppercase tracking-widest text-t-bone-dim">{assetId}</span>
      <span className="max-w-xs font-term text-sm text-t-bone-dim">{alt}</span>
    </div>
  );
}
