/**
 * ExitButton — Always visible, persistent across all pages.
 *
 * Design brief principle 10: "Exit always available"
 * "Leave this page" button visible on every screen.
 * Fixed position, top-right, accessible.
 */

"use client";

interface ExitButtonProps {
  /** Where to go when exiting. Defaults to "/" */
  href?: string;
  /** Optional custom label */
  label?: string;
}

export function ExitButton({
  href = "/",
  label = "Leave this page",
}: ExitButtonProps) {
  return (
    <div className="fixed top-4 right-4 z-50">
      <a
        href={href}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/90 backdrop-blur-sm border border-border text-sm text-muted hover:text-foreground hover:bg-white transition-colors min-h-[3rem] shadow-sm"
        aria-label={label}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M12 4L4 12M4 4L12 12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        {label}
      </a>
    </div>
  );
}
