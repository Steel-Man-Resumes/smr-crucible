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
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={inputId}
          className="text-sm font-semibold text-t-white"
        >
          {label}
        </label>
        {helper && <p className="text-sm text-t-bone-dim">{helper}</p>}
        <div className="terminal-field terminal-field--area">
          <textarea
            ref={ref}
            id={inputId}
            rows={4}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : undefined}
            className={`min-h-[140px] w-full resize-y border py-3 pl-9 pr-4 text-base transition-colors focus:outline-none ${error ? "border-t-red" : "border-[#3b4039]"}`}
            {...props}
          />
        </div>
        {error && (
          <p id={`${inputId}-error`} className="font-term text-sm text-t-red" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);
