/**
 * CardSelect — Touch-friendly option cards for flow pages.
 *
 * Design brief constraints:
 * - 48px min touch target
 * - 3-4 options max per question
 * - Clear selected state
 * - Accessible labels
 *
 * Hand-Forged Terminal skin (Wave C, 2026-07-08).
 */

"use client";

import { Check } from "lucide-react";

interface CardSelectOption {
  id: string;
  label: string;
  description?: string;
}

interface CardSelectProps {
  /** Available options (max 4 per design brief) */
  options: CardSelectOption[];
  /** Currently selected option ID(s) */
  selected: string | string[];
  /** Selection handler */
  onSelect: (id: string) => void;
  /** Allow multiple selections */
  multi?: boolean;
}

export function CardSelect({
  options,
  selected,
  onSelect,
  multi = false,
}: CardSelectProps) {
  const selectedSet = new Set(
    Array.isArray(selected) ? selected : selected ? [selected] : []
  );

  return (
    <div className="flex flex-col gap-3 font-body" role={multi ? "group" : "radiogroup"}>
      {options.map((option) => {
        const isSelected = selectedSet.has(option.id);
        return (
          <button
            key={option.id}
            onClick={() => onSelect(option.id)}
            role={multi ? "checkbox" : "radio"}
            aria-checked={isSelected}
            className={`t-focus min-h-touch w-full rounded-[6px] border px-5 py-4 text-left shadow-[0_2px_8px_rgba(22,26,21,0.04)] transition-all ${
              isSelected
                ? "border-[#4f6b57] bg-[#e3ede5] text-t-white"
                : "border-t-line bg-t-panel text-t-white hover:border-t-line-strong hover:bg-t-panel-2"
            }`}
          >
            <div className="flex items-center gap-3">
              {/* Selection indicator */}
              <div
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[3px] border ${
                  isSelected ? "border-[#4f6b57] bg-[#4f6b57]" : "border-t-line-strong bg-white"
                }`}
              >
                {isSelected && (
                  <Check size={13} strokeWidth={2.4} className="text-white" aria-hidden="true" />
                )}
              </div>

              <div>
                <span className="font-medium">{option.label}</span>
                {option.description && (
                  <p className="text-sm text-t-bone-dim mt-0.5">
                    {option.description}
                  </p>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
