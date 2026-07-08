/**
 * TextArea — For free-text narrative input.
 *
 * Critical for affect labeling (Lieberman 2007) and
 * expressive writing (Pennebaker). The free text fields
 * ARE the therapeutic mechanism — they must be comfortable,
 * spacious, and never feel like a form.
 *
 * Hand-Forged Terminal skin (Wave C, 2026-07-08).
 */

"use client";

import { forwardRef } from "react";

interface TextAreaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {
  /** Label text */
  label: string;
  /** Optional helper/prompt text */
  helper?: string;
  /** Error message */
  error?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea({ label, helper, error, id, ...props }, ref) {
    const inputId = id || `textarea-${label.toLowerCase().replace(/\s+/g, "-")}`;

    return (
      <div className="flex flex-col gap-1.5 font-term">
        <label
          htmlFor={inputId}
          className="text-base font-medium text-t-white"
        >
          {label}
        </label>
        {helper && <p className="text-sm text-t-phos-dim">{helper}</p>}
        <textarea
          ref={ref}
          id={inputId}
          rows={4}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={`w-full px-4 py-3 border text-base bg-t-panel text-t-white transition-colors resize-y min-h-[120px] focus:outline-none ${
            error
              ? "border-t-red focus:border-t-red"
              : "border-t-line focus:border-t-amber"
          }`}
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="text-sm text-t-red" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);
