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

/** Inverse of `encodeShare`. Returns null on any decode/parse failure. */
export function decodeShare(s: string): SharePayload | null {
  try {
    const bytes = base64UrlToBytes(s);
    const json = pako.inflate(bytes, { to: "string" });
    const parsed = JSON.parse(json) as {
      settings?: LabSettings;
      baskets?: Basket[];
    };
    if (!parsed.settings || !Array.isArray(parsed.baskets)) return null;
    return { settings: parsed.settings, baskets: parsed.baskets };
  } catch {
    return null;
  }
}
