/**
 * CardSelect — Touch-friendly option cards for flow pages.
 *
 * Design brief constraints:
 * - 48px min touch target
 * - 3-4 options max per question
 * - Clear selected state
 * - Accessible labels
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
    <div className="flex flex-col gap-3" role={multi ? "group" : "radiogroup"}>
      {options.map((option) => {
        const isSelected = selectedSet.has(option.id);
        return (
          <button
            key={option.id}
            onClick={() => onSelect(option.id)}
            role={multi ? "checkbox" : "radio"}
            aria-checked={isSelected}
            className={`w-full text-left px-5 py-4 rounded-xl border-2 transition-all min-h-touch ${
              isSelected
                ? "border-sage-600 bg-sage-50 text-foreground"
                : "border-border bg-white text-foreground hover:border-sage-300 hover:bg-sage-50/50"
            }`}
          >
            <div className="flex items-center gap-3">
              {/* Selection indicator */}
              <div
                className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  isSelected ? "border-sage-600 bg-sage-600" : "border-muted"
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
                      stroke="white"
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
                  <p className="text-sm text-muted mt-0.5">
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
