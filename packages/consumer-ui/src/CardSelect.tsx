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
            className={`t-focus w-full text-left px-5 py-4 border transition-all min-h-touch ${
              isSelected
                ? "border-t-amber bg-t-panel-2 text-t-white"
                : "border-t-line bg-t-panel text-t-white hover:border-t-phos-dim"
            }`}
          >
            <div className="flex items-center gap-3">
              {/* Selection indicator */}
              <div
                className={`flex-shrink-0 w-5 h-5 border flex items-center justify-center ${
                  isSelected ? "border-t-amber bg-t-amber" : "border-t-phos-dim"
                }`}
              >
                {isSelected && (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M2.5 6L5 8.5L9.5 3.5"
                      stroke="#14100a"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
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
