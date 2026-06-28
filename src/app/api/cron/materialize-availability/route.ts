import { materializeAllActiveSchedules } from "@/lib/availability/generate";

// Cron-driven worker that rolls every active availability_schedule's
// materialization window forward — generating concrete `availabilities` slots
// for the next `materialize_days_ahead` days and pruning stale ones. Scheduled
// daily via vercel.json. Generation also runs synchronously on schedule save;
// this cron keeps the horizon populated as days pass.

export const maxDuration = 60;

function authorized(req: Request): boolean {
  // Vercel cron sends Authorization: Bearer <CRON_SECRET> when the env var is
  // set. Accept all in dev when no secret is configured.
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await materializeAllActiveSchedules(new Date());
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("materialize-availability cron failed", err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
