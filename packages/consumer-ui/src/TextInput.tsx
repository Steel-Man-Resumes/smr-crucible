/**
 * TextInput — Accessible text input for flow pages.
 *
 * Design brief constraints:
 * - 18px font minimum
 * - 48px touch target
 * - Clear labels
 * - WCAG 2.2 AA focus indicators
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
          className="text-body font-medium text-foreground"
        >
          {label}
        </label>
        {helper && <p className="text-sm text-muted">{helper}</p>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={`w-full px-4 py-3 rounded-xl border-2 text-body bg-white transition-colors min-h-touch ${
            error
              ? "border-earth-600 focus:border-earth-700"
              : "border-border focus:border-sage-600"
          }`}
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="text-sm text-earth-600" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);
