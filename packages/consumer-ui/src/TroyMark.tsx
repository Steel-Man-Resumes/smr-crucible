/**
 * TroyMark: t.ROY's one mark, the hooded figure with the letter t.
 *
 * FL2 (Troy's walk, 2026-10-05): "The t.ROY icon is different from the one on
 * the SMR site. Make it one icon." The SMR site shows this figure wherever
 * t.ROY appears on every page (its chat button and the reading figure), so
 * the Forge and the Refinery use the same file everywhere t.ROY is shown as
 * an icon: TroyLivingIcon (the figure with a glow) and this still version for
 * small inline spots. The gold compass badge is not used for t.ROY here.
 *
 * Presentational, no motion, no client hooks.
 */

export const TROY_MARK_SRC = "/images/t-roy-figure.png";

export function TroyMark({
  size = 20,
  alt = "",
  className = "",
}: {
  /** Height and width of the square box in px. The figure keeps its shape inside it. */
  size?: number;
  /** "" when a nearby label already says t.ROY (the default); otherwise "t.ROY". */
  alt?: string;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={TROY_MARK_SRC}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
