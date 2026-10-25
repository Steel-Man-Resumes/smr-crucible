"use client";

/**
 * One small line under a Settings control whose save did not land, with the
 * route's own words (lib/save-error.ts). Renders nothing when there is none.
 */
export function SaveError({ message, className = "" }: { message: string | null | undefined; className?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className={`text-sm text-t-red mt-2 ${className}`.trim()}>
      {message}
    </p>
  );
}
