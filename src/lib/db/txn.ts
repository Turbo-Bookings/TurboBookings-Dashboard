import "server-only";
import { Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// Transactional DB over the Neon WebSocket driver (the default neon-http client
// in db/index.ts can't do transactions). Used for oversell-safe booking commit
// + reschedule: SELECT … FOR UPDATE the slot, re-check capacity, write atomically.
// Opens + closes a Pool per call (serverless-safe), on the UNPOOLED connection.

type Db = NeonDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

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
