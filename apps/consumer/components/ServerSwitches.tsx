"use client";

/**
 * Server switches handed to client pages by a server layout, so a client page
 * can hide what the server has switched off without a fetch and without
 * reading the environment itself. The default is everything OFF: a page
 * rendered without the provider shows nothing that a switch controls.
 */

import { createContext, useContext, type ReactNode } from "react";

export interface ServerSwitches {
  /** The record check step (D11) is on (lib/server-switch.ts). */
  recordStep: boolean;
}

const OFF: ServerSwitches = { recordStep: false };

const Ctx = createContext<ServerSwitches>(OFF);

export function ServerSwitchesProvider({ value, children }: { value: ServerSwitches; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useServerSwitches(): ServerSwitches {
  return useContext(Ctx);
}
