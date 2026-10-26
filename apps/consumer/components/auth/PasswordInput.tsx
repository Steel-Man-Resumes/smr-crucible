"use client";

import { useState, type ComponentProps } from "react";

/** Keep password-manager support and let someone check their typing. */
export function PasswordInput({ id, className = "", disabled, ...props }: Omit<ComponentProps<"input">, "type"> & { id: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} id={id} type={visible ? "text" : "password"} disabled={disabled} className={`${className} pr-20`} />
      <button
        type="button"
        aria-controls={id}
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible((value) => !value)}
        disabled={disabled}
        className="t-focus absolute inset-y-0 right-1 min-h-[44px] min-w-[64px] px-2 text-sm font-medium text-t-amber-bright disabled:opacity-50"
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}
