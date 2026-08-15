import pako from "pako";
import type { Basket, LabSettings } from "../types";

export type SharePayload = {
  settings: LabSettings;
  baskets: Basket[];
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** JSON → pako.deflate → base64url (no `+`, `/`, or `=`). */
export function encodeShare(payload: SharePayload): string {
  const json = JSON.stringify(payload);
  const deflated = pako.deflate(json);
  return bytesToBase64Url(deflated);
}

function isSharePayload(value: unknown): value is SharePayload {
  if (value == null || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  if (
    rec.settings == null ||
    typeof rec.settings !== "object" ||
    Array.isArray(rec.settings)
  ) {
    return false;
  }
  if (!Array.isArray(rec.baskets)) return false;
  return rec.baskets.every((basket) => {
    if (basket == null || typeof basket !== "object" || Array.isArray(basket)) {
      return false;
    }
    return Array.isArray((basket as { funds?: unknown }).funds);
  });
}

/** Inverse of `encodeShare`. Returns null on any decode/parse failure. */
export function decodeShare(s: string): SharePayload | null {
  try {
    const bytes = base64UrlToBytes(s);
    const json = pako.inflate(bytes, { to: "string" });
    const parsed: unknown = JSON.parse(json);
    if (!isSharePayload(parsed)) return null;
    return { settings: parsed.settings, baskets: parsed.baskets };
  } catch {
    return null;
  }
}
