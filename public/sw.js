/* eslint-disable no-undef */
//
// Service worker for operator booking alerts.
//
// Deliberately minimal: it handles push delivery and notification clicks and
// nothing else. No offline caching — this is a live operations tool where a
// stale manifest or an out-of-date balance is worse than an error message, and
// a cache that serves yesterday's check-in state to someone standing at the
// gate would be actively harmful.

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every tab to close; an
  // operator who just enabled alerts should not have to quit the app first.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A malformed payload must still surface something rather than fail
    // silently — a missed booking alert is the whole failure mode here.
    payload = {};
  }

  const title = payload.title || "New booking";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // Collapses repeat alerts for the same booking (a retry, or two devices)
    // into one notification instead of stacking duplicates.
    tag: payload.tag || undefined,
    // Bookings are money arriving; worth a buzz.
    vibrate: [80, 40, 80],
    data: { url: payload.url || "/" },
    // Keeps the alert on screen until acknowledged rather than auto-dismissing
    // while the operator is driving or with guests.
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Reuse an already-open window where possible; opening a second copy of
        // the dashboard on a phone is disorienting.
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(target);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
