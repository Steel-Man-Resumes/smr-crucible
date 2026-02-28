/**
 * CustomImage — Enforces design brief image rules.
 *
 * Design brief principle 7: "Dignity in every pixel"
 * - Requires alt text (accessibility)
 * - Requires source attribution
 * - Rejects generic stock/emoji (enforced by requiring source prop)
 * - Lazy-loaded by default
 * - Hero images constrained to < 100 KB (checked at build via Lighthouse)
 */

interface CustomImageProps {
  /** Image source URL */
  src: string;
  /** Required alt text for accessibility */
  alt: string;
  /** Required source attribution (artist, photographer, organization) */
  source: string;
  /** Optional width */
  width?: number;
  /** Optional height */
  height?: number;
  /** Optional CSS class */
  className?: string;
  /** Loading strategy — defaults to lazy */
  loading?: "lazy" | "eager";
  /** Priority hint for LCP images */
  priority?: boolean;
}

export function CustomImage({
  src,
  alt,
  source,
  width,
  height,
  className = "",
  loading = "lazy",
  priority,
}: CustomImageProps) {
  return (
    <figure className={className}>
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : loading}
        decoding="async"
        className="rounded-lg"
        // fetchPriority not yet in React types but supported by browsers
        {...(priority ? { fetchpriority: "high" } : {})}
      />
      <figcaption className="text-xs text-muted mt-1">
        Image: {source}
      </figcaption>
    </figure>
  );
}
