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
      <div className="flex flex-col gap-1.5 font-term">
        <label
          htmlFor={inputId}
          className="text-base font-medium text-t-white"
        >
          {label}
        </label>
        {helper && <p className="text-sm text-t-phos-dim">{helper}</p>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={`w-full px-4 py-3 border text-base bg-t-panel text-t-white transition-colors min-h-touch focus:outline-none ${
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
