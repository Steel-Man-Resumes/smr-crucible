"use client";

/**
 * Is an admin viewing this account as someone else right now? (security
 * review 3a Part 2 r1, M3.) The Forge has no RoleProvider, so it asks the
 * impersonation status route itself, once per sign-in.
 *  - false: no one is being impersonated; the Forge may save and load;
 *  - true:  an admin is viewing as someone; the Forge saves and loads nothing;
 *  - null:  not known yet, or the check failed; treated like true (do nothing
 *           on this page; the next page asks again).
 * Signed out: false without asking (nothing can be impersonated).
 */

import { useEffect, useState } from "react";

export function useImpersonating(signedIn: boolean): boolean | null {
  const [state, setState] = useState<boolean | null>(signedIn ? null : false);
  useEffect(() => {
    if (!signedIn) {
      setState(false);
      return;
    }
    let live = true;
    setState(null);
    fetch("/api/dev/impersonate")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live) setState(j && typeof j === "object" ? j.active === true : null);
      })
      .catch(() => {
        if (live) setState(null);
      });
    return () => {
      live = false;
    };
  }, [signedIn]);
  return state;
}
