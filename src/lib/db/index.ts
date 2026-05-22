import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Lazy singleton so `next build` doesn't require DATABASE_URL at build time —
// only requests that actually hit the DB will fail when the env var is missing.
let dbInstance: NeonHttpDatabase<typeof schema> | null = null;

export function getDb(): NeonHttpDatabase<typeof schema> {
  if (dbInstance) return dbInstance;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }
  dbInstance = drizzle(neon(databaseUrl), { schema });
  return dbInstance;
}

export * from "./schema";
