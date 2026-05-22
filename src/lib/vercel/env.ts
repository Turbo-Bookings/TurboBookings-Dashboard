import "server-only";

// Thin Vercel API wrapper for setting per-project env vars from the admin.
// Operations gracefully no-op when VERCEL_API_TOKEN isn't configured — the
// admin still functions, secrets just stay in the admin DB without being
// mirrored to the location's Vercel project. UI surfaces this state so
// operators know what's actually live.

type VercelEnvTarget = "production" | "preview" | "development";

export type EnvPushResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "no_project_id" | "api_error"; message?: string };

function getApiToken(): string | null {
  return process.env.VERCEL_API_TOKEN ?? null;
}

const TEAM_ID = process.env.VERCEL_TEAM_ID; // optional — needed for team projects

function withTeam(url: string): string {
  return TEAM_ID ? `${url}${url.includes("?") ? "&" : "?"}teamId=${TEAM_ID}` : url;
}

// Set a single env var on a project for all three targets. Replaces any
// existing var with the same key. Idempotent on rerun.
export async function setProjectEnv(
  projectId: string | null,
  key: string,
  value: string,
  targets: VercelEnvTarget[] = ["production", "preview", "development"],
): Promise<EnvPushResult> {
  const token = getApiToken();
  if (!token) return { ok: false, reason: "not_configured" };
  if (!projectId) return { ok: false, reason: "no_project_id" };

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  // First, delete any existing var with the same key. Vercel's API treats
  // create + update as separate endpoints; cleanest path is delete-then-
  // create so we don't have to first GET the existing record's ID.
  try {
    const listRes = await fetch(
      withTeam(`https://api.vercel.com/v9/projects/${projectId}/env`),
      { headers, cache: "no-store" },
    );
    if (listRes.ok) {
      const data = (await listRes.json()) as { envs?: Array<{ id: string; key: string }> };
      const match = (data.envs ?? []).find((e) => e.key === key);
      if (match) {
        await fetch(
          withTeam(
            `https://api.vercel.com/v9/projects/${projectId}/env/${match.id}`,
          ),
          { method: "DELETE", headers },
        );
      }
    }
  } catch {
    // Non-fatal — continue with the create attempt.
  }

  const createRes = await fetch(
    withTeam(`https://api.vercel.com/v10/projects/${projectId}/env`),
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        key,
        value,
        type: "encrypted",
        target: targets,
      }),
    },
  );

  if (!createRes.ok) {
    const text = await createRes.text().catch(() => "");
    return {
      ok: false,
      reason: "api_error",
      message: `Vercel API ${createRes.status}: ${text.slice(0, 200)}`,
    };
  }
  return { ok: true };
}

export function vercelTokenConfigured(): boolean {
  return !!getApiToken();
}
