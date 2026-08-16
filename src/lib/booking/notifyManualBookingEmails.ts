import "server-only";

// Server-only re-export. The implementation lives in ./lifecycleTrigger so the
// importer CLI can use it too — `server-only` throws outside the Next runtime.
export {
  notifyManualBookingEmails,
  type LifecycleParts,
} from "./lifecycleTrigger";
