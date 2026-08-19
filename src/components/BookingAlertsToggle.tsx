"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Loader2, Share } from "lucide-react";
import {
  deletePushSubscription,
  isPushSubscribed,
  savePushSubscription,
  sendTestPush,
} from "@/lib/actions/pushAlerts";

// "Turn on booking alerts" — per-device web push opt-in.
//
// Per DEVICE, not per account, on purpose: a push subscription belongs to one
// browser install. Someone signed in on both a phone and an office desktop
// turns it on where they actually want to be buzzed, and turning it off on the
// phone must not silence the desktop.

type State =
  | "loading"
  | "unsupported"
  | "needs-install" // iOS Safari, not yet added to the Home Screen
  | "blocked" // permission denied at the OS/browser level
  | "off"
  | "on";

// Push keys travel as base64url; PushManager wants raw bytes.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  // Allocated from a plain ArrayBuffer so it satisfies BufferSource — the
  // default Uint8Array type admits SharedArrayBuffer, which PushManager rejects.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Macintosh, so touch points are the reliable tell.
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own non-standard flag, which is the one that actually works on iOS.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function BookingAlertsToggle({ slug }: { slug: string }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  // Returns the state rather than setting it, so the effect's only setState
  // happens in a callback — a synchronous setState in an effect body triggers
  // cascading renders (and React's lint rule).
  const computeState = useCallback(async (): Promise<State> => {
    if (!publicKey) return "unsupported";
    if (!("serviceWorker" in navigator) || !("PushManager" in window))
      // On iOS the Push API only exists inside an installed PWA, so a missing
      // PushManager there means "not installed yet", not "never going to work".
      return isIosSafari() ? "needs-install" : "unsupported";
    if (isIosSafari() && !isStandalone()) return "needs-install";
    if (Notification.permission === "denied") return "blocked";

    const reg = await navigator.serviceWorker.register("/sw.js");
    const existing = await reg.pushManager.getSubscription();
    if (!existing) return "off";
    // The browser can hold a subscription this location's DB doesn't know about
    // (another location, a wiped row). Trust the server for the on/off state.
    return (await isPushSubscribed(slug, existing.endpoint)) ? "on" : "off";
  }, [publicKey, slug]);

  useEffect(() => {
    let live = true;
    computeState().then(
      (s) => live && setState(s),
      () => live && setState("unsupported"),
    );
    return () => {
      live = false;
    };
  }, [computeState]);

  async function enable() {
    setBusy(true);
    setMsg(null);
    try {
      // Must be inside the click handler — Safari drops the user-gesture
      // association if anything is awaited before requestPermission().
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey!),
        }));
      const json = sub.toJSON();
      const res = await savePushSubscription(
        slug,
        {
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
        },
        navigator.userAgent,
      );
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setState("on");
      setMsg("Alerts on for this device.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not turn on alerts.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await deletePushSubscription(slug, sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      setMsg("Alerts off for this device.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    const res = await sendTestPush(slug);
    setMsg(
      res.sent > 0
        ? "Test sent — it should arrive in a few seconds."
        : "Nothing was sent. Try turning alerts off and on again.",
    );
    setBusy(false);
  }

  if (state === "loading" || state === "unsupported") return null;

  return (
    <div className="mt-5 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            state === "on"
              ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
        >
          {state === "on" ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Booking alerts on this device
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {state === "on"
              ? "You'll get a notification the moment a booking comes in."
              : state === "blocked"
                ? "Notifications are blocked in your browser or phone settings. Allow them for this site, then reload."
                : state === "needs-install"
                  ? "On iPhone, alerts only work once the dashboard is on your Home Screen."
                  : "Get a notification the moment a booking comes in."}
          </p>

          {state === "needs-install" && (
            <ol className="mt-2 space-y-1 text-xs text-zinc-500">
              <li className="flex items-center gap-1.5">
                <Share className="h-3.5 w-3.5 shrink-0" /> 1. Tap Share in Safari
              </li>
              <li>2. Tap “Add to Home Screen”</li>
              <li>3. Open the dashboard from the new icon and come back here</li>
            </ol>
          )}

          {msg && <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">{msg}</p>}
        </div>

        {(state === "on" || state === "off") && (
          <div className="flex shrink-0 items-center gap-2">
            {state === "on" && (
              <button
                type="button"
                onClick={test}
                disabled={busy}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Send test
              </button>
            )}
            <button
              type="button"
              onClick={state === "on" ? disable : enable}
              disabled={busy}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                state === "on"
                  ? "border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  : "bg-blue-600 text-white hover:bg-blue-500"
              }`}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {state === "on" ? "Turn off" : "Turn on"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
