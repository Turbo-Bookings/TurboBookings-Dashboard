import { Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// Transactional DB over the Neon WebSocket driver (the default neon-http client
// in db/index.ts can't do transactions). Opens + closes a Pool per call
// (serverless-safe), on the UNPOOLED connection.
//
// Deliberately NOT marked `server-only`: CLI scripts (the FareHarbor importer,
// the Stripe pre-flight) need transactions too, and `server-only` throws outside
// the Next runtime. App code should import from ./txn, which re-exports this
// behind the guard.

export type Db = NeonDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function withTxn<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set");
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  try {
    return await db.transaction((tx) => fn(tx));
  } finally {
    await pool.end();
  }
}
