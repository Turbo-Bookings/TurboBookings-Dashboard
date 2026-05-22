import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM. Each ciphertext carries its own IV (12 bytes) and auth tag
// (16 bytes), encoded as base64(iv || tag || ciphertext). Same key used
// across all environments because the underlying Neon database is shared.

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const hex = process.env.ADMIN_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "ADMIN_ENCRYPTION_KEY is not set — secrets cannot be encrypted/decrypted",
    );
  }
  if (hex.length !== 64) {
    throw new Error(
      "ADMIN_ENCRYPTION_KEY must be 32 bytes (64 hex characters)",
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const dec = createDecipheriv(ALGO, getKey(), iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(ct), dec.final()]).toString("utf8");
}
