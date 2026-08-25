"use client";

import { createContext, useContext } from "react";
import { NO_CAPS, type Capabilities } from "@/lib/auth/capabilities";

// The current user's capabilities, resolved server-side in the location layout
// and provided to client components so they can hide controls they can't use.
//
// Defaults to all-false (safest) if a consumer renders outside the provider. Imported from
// `@/lib/auth/capabilities` rather than spelled out here: this list used to be maintained by hand and
// fell out of date the moment a capability was added, and a missing key reads as `undefined` —
// falsy, so still safe, but silently so, which is the wrong way to be right.
const CapabilitiesContext = createContext<Capabilities>(NO_CAPS);

export function CapabilitiesProvider({
  caps,
  children,
}: {
  caps: Capabilities;
  children: React.ReactNode;
}) {
  return (
    <CapabilitiesContext.Provider value={caps}>
      {children}
    </CapabilitiesContext.Provider>
  );
}

export function useCaps(): Capabilities {
  return useContext(CapabilitiesContext);
}
