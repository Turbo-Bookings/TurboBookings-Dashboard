"use client";

import "driver.js/dist/driver.css";
import { driver, type Driver } from "driver.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Capabilities } from "@/lib/auth/roles";
import { markTourSeen } from "@/lib/actions/onboarding";
import { stepsForCaps } from "./steps";

type TourCtx = { startTour: () => void };
const Ctx = createContext<TourCtx>({ startTour: () => {} });
export const useTour = () => useContext(Ctx);

// Waits for a [data-tour="id"] element to appear (after a route change the new
// server-rendered page mounts asynchronously). Calls cb once found, or after a
// timeout regardless so the tour never hard-stalls.
function waitForTarget(target: string | undefined, cb: () => void) {
  if (!target) return cb();
  if (document.querySelector(`[data-tour="${target}"]`)) return cb();
  const start = Date.now();
  const iv = window.setInterval(() => {
    if (
      document.querySelector(`[data-tour="${target}"]`) ||
      Date.now() - start > 4000
    ) {
      window.clearInterval(iv);
      cb();
    }
  }, 80);
}

export function TourProvider({
  slug,
  caps,
  autoStart,
  children,
}: {
  slug: string;
  caps: Capabilities;
  autoStart: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Mutable holders — written ONLY inside effects/handlers (never during render).
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const stepsRef = useRef(stepsForCaps(caps));
  useEffect(() => {
    stepsRef.current = stepsForCaps(caps);
  }, [caps]);

  const driverRef = useRef<Driver | null>(null);
  const seenMarkedRef = useRef(false);
  // The imperative stepper lives in a ref so it can recurse (prev/next across
  // pages) without a forward reference or changing identity.
  const showStepRef = useRef<(i: number) => void>(() => {});

  const endTour = useCallback(() => {
    // Mark seen once per run (covers close button, finish, ESC, overlay click).
    if (!seenMarkedRef.current) {
      seenMarkedRef.current = true;
      markTourSeen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    showStepRef.current = (i: number) => {
      const steps = stepsRef.current;
      const s = steps[i];
      const d = driverRef.current;
      if (!s || !d) return;
      const isFirst = i === 0;
      const isLast = i === steps.length - 1;

      const render = () => {
        const el = s.centered
          ? undefined
          : (document.querySelector(`[data-tour="${s.target}"]`) as
              | HTMLElement
              | null) ?? undefined;
        d.highlight({
          element: el,
          popover: {
            title: s.title,
            description: s.body,
            showButtons: [
              ...(isFirst ? [] : (["previous"] as const)),
              "next" as const,
              "close" as const,
            ],
            nextBtnText: isLast ? "Done" : "Next →",
            prevBtnText: "← Back",
            onPrevClick: () => showStepRef.current(i - 1),
            onNextClick: () => (isLast ? d.destroy() : showStepRef.current(i + 1)),
            onCloseClick: () => d.destroy(),
          },
        });
      };

      const full = s.route == null ? null : `/locations/${slug}${s.route}`;
      if (full && full !== pathRef.current) {
        router.push(full);
        // Give the route a tick to commit, then wait for the target element.
        window.setTimeout(() => waitForTarget(s.target, render), 60);
      } else {
        waitForTarget(s.target, render);
      }
    };
  }, [router, slug]);

  const startTour = useCallback(() => {
    if (stepsRef.current.length === 0) return;
    seenMarkedRef.current = false;
    if (!driverRef.current) {
      driverRef.current = driver({
        allowClose: true,
        stagePadding: 6,
        stageRadius: 8,
        popoverClass: "tb-tour",
        overlayOpacity: 0.6,
        onDestroyed: () => endTour(),
      });
    }
    showStepRef.current(0);
  }, [endTour]);

  // Auto-launch once on first login (after a beat so the shell has rendered).
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    autoStartedRef.current = true;
    const t = window.setTimeout(() => startTour(), 700);
    return () => window.clearTimeout(t);
  }, [autoStart, startTour]);

  // Tear down the driver instance on unmount.
  useEffect(() => {
    return () => {
      driverRef.current?.destroy();
      driverRef.current = null;
    };
  }, []);

  return <Ctx.Provider value={{ startTour }}>{children}</Ctx.Provider>;
}
