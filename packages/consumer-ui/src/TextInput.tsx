/**
 * TextInput — Accessible text input for flow pages.
 *
 * Design brief constraints:
 * - 15-16px monospace minimum
 * - 48px touch target
 * - Clear labels
 * - WCAG 2.2 AA focus indicators
 *
 * Hand-Forged Terminal skin (Wave C, 2026-07-08).
 */

"use client";

import { forwardRef } from "react";

interface TextInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "className"> {
  /** Label text (required for accessibility) */
  label: string;
  /** Optional helper text */
  helper?: string;
  /** Error message */
  error?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ label, helper, error, id, ...props }, ref) {
    const inputId = id || `input-${label.toLowerCase().replace(/\s+/g, "-")}`;

    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={inputId}
          className="text-sm font-semibold text-t-white"
        >
          {label}
        </label>
        {helper && <p className="text-sm text-t-bone-dim">{helper}</p>}
        <div className="terminal-field">
          <input
            ref={ref}
            id={inputId}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : undefined}
            className={`min-h-touch w-full border py-3 pl-9 pr-4 text-base transition-colors focus:outline-none ${error ? "border-t-red" : "border-[#3b4039]"}`}
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
