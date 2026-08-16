import "server-only";

// Server-only re-export of the transactional DB helper. The implementation
// lives in ./pool so CLI scripts can use it too — `server-only` throws outside
// the Next runtime, and the importer / pre-flight scripts need transactions.
// Used for oversell-safe booking commit + reschedule: SELECT … FOR UPDATE the
// slot, re-check capacity, write atomically.
export { withTxn, type Db, type Tx } from "./pool";
