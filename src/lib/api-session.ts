export const API_SESSION_COOKIE = "lc_api_session";

const API_SESSION_MAX_AGE_SECONDS = 60 * 60 * 2;
const HMAC_ALGORITHM = { name: "HMAC", hash: "SHA-256" };
const MIN_SESSION_SECRET_LENGTH = 32;
const TOKEN_PARTS = 3;

export function getApiSessionMaxAgeSeconds() {
  return API_SESSION_MAX_AGE_SECONDS;
}

export async function createApiSessionToken(now = Date.now()) {
  const secret = getApiSessionSecret();

  if (!secret) {
    return null;
  }

  const issuedAt = String(now);
  const nonce = crypto.randomUUID();
  const payload = `${issuedAt}.${nonce}`;
  const signature = await signApiSessionPayload(payload, secret);

  return `${payload}.${signature}`;
}

export async function verifyApiSessionToken(
  token: string | null | undefined,
  now = Date.now()
) {
  const secret = getApiSessionSecret();

  if (!secret || !token) {
    return false;
  }

  const parts = token.split(".");

  if (parts.length !== TOKEN_PARTS) {
    return false;
  }

  const [issuedAtText, nonce, signature] = parts;
  const issuedAt = Number(issuedAtText);

  if (!Number.isFinite(issuedAt) || !nonce || !signature) {
    return false;
  }

  const ageMs = now - issuedAt;

  if (ageMs < 0 || ageMs > API_SESSION_MAX_AGE_SECONDS * 1000) {
    return false;
  }

  return verifyApiSessionSignature(`${issuedAtText}.${nonce}`, signature, secret);
}

export function getApiSessionConfigError() {
  const secret = process.env.LYRICAL_CONTEXT_SESSION_SECRET?.trim() ?? "";

  if (!requiresStrongSessionSecret()) {
    return null;
  }

  if (!secret) {
    return "Set LYRICAL_CONTEXT_SESSION_SECRET before requiring API sessions.";
  }

  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    return `LYRICAL_CONTEXT_SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters.`;
  }

  return null;
}

function getApiSessionSecret() {
  const secret = process.env.LYRICAL_CONTEXT_SESSION_SECRET?.trim() ?? "";

  if (!secret) {
    return "";
  }

  if (requiresStrongSessionSecret() && secret.length < MIN_SESSION_SECRET_LENGTH) {
    return "";
  }

  return secret;
}

function requiresStrongSessionSecret() {
  return process.env.LYRICAL_CONTEXT_REQUIRE_API_SESSION === "true";
}

async function signApiSessionPayload(payload: string, secret: string) {
  const signature = await crypto.subtle.sign(
    HMAC_ALGORITHM,
    await importHmacKey(secret, ["sign"]),
    new TextEncoder().encode(payload)
  );

  return base64UrlEncode(new Uint8Array(signature));
}

async function verifyApiSessionSignature(
  payload: string,
  signature: string,
  secret: string
) {
  const signatureBytes = base64UrlDecode(signature);

  if (!signatureBytes) {
    return false;
  }

  return crypto.subtle.verify(
    HMAC_ALGORITHM,
    await importHmacKey(secret, ["verify"]),
    signatureBytes,
    new TextEncoder().encode(payload)
  );
}

async function importHmacKey(secret: string, keyUsages: KeyUsage[]) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    HMAC_ALGORITHM,
    false,
    keyUsages
  );
}

function base64UrlEncode(bytes: Uint8Array) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string) {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
