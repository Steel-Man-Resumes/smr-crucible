/**
 * TextArea — For free-text narrative input.
 *
 * Critical for affect labeling (Lieberman 2007) and
 * expressive writing (Pennebaker). The free text fields
 * ARE the therapeutic mechanism — they must be comfortable,
 * spacious, and never feel like a form.
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
          className="text-body font-medium text-foreground"
        >
          {label}
        </label>
        {helper && <p className="text-sm text-muted">{helper}</p>}
        <textarea
          ref={ref}
          id={inputId}
          rows={4}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={`w-full px-4 py-3 rounded-xl border-2 text-body bg-white transition-colors resize-y min-h-[120px] ${
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
