"use client";

/**
 * "Where are you located?" with suggestions as you type: a US city, county
 * or ZIP from the public Census list (lib/location-search.ts).
 *
 * Privacy: the list is one static file, fetched the first time the field is
 * focused. Every search runs here, in the browser. What the person types is
 * never sent anywhere.
 *
 * Free text always works: a place missing from the list saves exactly as typed.
 * Keyboard: Down/Up move through suggestions, Enter picks, Escape closes.
 */

import { useEffect, useId, useRef, useState } from "react";
import {
  LOCATION_DATA_URL,
  buildLocationIndex,
  resolveZip,
  searchLocations,
  type LocationIndex,
  type LocationSuggestion,
} from "@/lib/location-search";

let indexPromise: Promise<LocationIndex> | null = null;

/** Load the list once per page load; a failure is retried next focus. */
function loadIndex(): Promise<LocationIndex> {
  if (!indexPromise) {
    indexPromise = fetch(LOCATION_DATA_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`location list ${r.status}`);
        return r.json();
      })
      .then(buildLocationIndex)
      .catch((err) => {
        indexPromise = null;
        throw err;
      });
  }
  return indexPromise;
}

export function LocationCombobox({
  id,
  value,
  onChange,
  disabled,
  placeholder = "City, state or ZIP",
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  describedBy?: string;
}) {
  const listId = useId();
  const statusId = useId();
  const [index, setIndex] = useState<LocationIndex | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [results, setResults] = useState<LocationSuggestion[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  function ensureLoaded() {
    if (index || disabled) return;
    loadIndex()
      .then((ix) => {
        setIndex(ix);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }

  // Recompute suggestions when the text or the list changes.
  useEffect(() => {
    if (!index) {
      setResults([]);
      return;
    }
    const r = searchLocations(index, value);
    // Nothing to suggest when the text already is the one suggestion.
    setResults(r.length === 1 && r[0].value === value ? [] : r);
    setActive(-1);
  }, [index, value]);

  function pick(s: LocationSuggestion) {
    onChange(s.value);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (!results.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      if (!results.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a <= 0 ? results.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && results[active]) {
        e.preventDefault();
        pick(results[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    }
  }

  function onBlur(e: React.FocusEvent) {
    if (wrapRef.current?.contains(e.relatedTarget as Node)) return;
    setOpen(false);
    setActive(-1);
    // A bare ZIP the list knows becomes "City, ST 12345", shown right here in
    // the field, so the state reaches the analysis.
    if (index) {
      const resolved = resolveZip(index, value);
      if (resolved) onChange(resolved);
    }
  }

  const expanded = open && results.length > 0;
  const activeId = expanded && active >= 0 ? `${listId}-opt-${active}` : undefined;

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-describedby={[describedBy, statusId].filter(Boolean).join(" ") || undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => {
          ensureLoaded();
          setOpen(true);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        className="w-full min-h-touch border border-t-line bg-t-panel px-4 py-3 text-base text-t-white transition-colors focus:border-t-amber focus:outline-none"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Places that match"
        hidden={!expanded}
        className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-y-auto border border-t-line-strong bg-t-panel shadow-lg"
      >
        {results.map((s, i) => (
          <li
            key={`${s.kind}-${s.value}`}
            id={`${listId}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(s)}
            onMouseEnter={() => setActive(i)}
            className={`flex min-h-touch cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-base ${
              i === active ? "bg-[#e3ede5] text-t-white" : "text-t-white"
            }`}
          >
            <span>{s.label}</span>
            {(s.detail || s.kind === "county") && (
              <span className="shrink-0 text-xs text-t-phos-dim">{s.detail ?? "county"}</span>
            )}
          </li>
        ))}
      </ul>
      <p id={statusId} className="sr-only" aria-live="polite">
        {expanded ? `${results.length} suggestion${results.length === 1 ? "" : "s"}. Use the arrow keys to choose.` : ""}
      </p>
      {failed && (
        <p className="mt-1 text-xs text-t-phos-dim">Suggestions didn&apos;t load. Type your city and state, like Lansing, MI.</p>
      )}
    </div>
  );
}
