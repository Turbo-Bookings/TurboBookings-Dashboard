"use client";

import { createContext, useContext } from "react";
import type { Capabilities } from "@/lib/auth/roles";

// The current user's capabilities, resolved server-side in the location layout
// and provided to client components so they can hide controls they can't use.
// Defaults to all-false (safest) if a consumer renders outside the provider.
const CapabilitiesContext = createContext<Capabilities>({
  checkin: false,
  manage_bookings: false,
  refund: false,
  manage_config: false,
  manage_team: false,
  manage_platform: false,
});

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
