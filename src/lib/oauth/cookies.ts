import crypto from 'node:crypto';

const AUTH_SECRET = process.env.AUTH_SECRET || 'clarity-default-development-secret-key-32-chars';

export interface OAuthStatePayload {
  state: string;
  codeVerifier: string;
  nonce: string;
  intent: 'login' | 'signup';
  next: string;
  createdAt: number;
}

export interface OAuthPendingPayload {
  sub: string;
  email: string;
  given_name?: string;
  family_name?: string;
  next?: string;
  createdAt: number;
}

export const OAUTH_STATE_COOKIE = 'clarity_oauth_state';
export const OAUTH_PENDING_COOKIE = 'clarity_oauth_pending';

/**
 * Sign a string payload with HMAC-SHA256: payload_b64.signature_b64
 */
export function signPayload<T>(payload: T): string {
  const json = JSON.stringify(payload);
  const dataB64 = Buffer.from(json).toString('base64url');
  const hmac = crypto.createHmac('sha256', AUTH_SECRET);
  hmac.update(dataB64);
  const sigB64 = hmac.digest('base64url');
  return `${dataB64}.${sigB64}`;
}

/**
 * Verify and parse a signed payload. Returns null if invalid or expired.
 */
export function verifySignedPayload<T>(token: string | undefined, maxAgeSeconds: number): T | null {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [dataB64, sigB64] = parts;
  const hmac = crypto.createHmac('sha256', AUTH_SECRET);
  hmac.update(dataB64);
  const expectedSig = hmac.digest('base64url');

  const sigBuf = Buffer.from(sigB64);
  const expectedBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const json = Buffer.from(dataB64, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json) as T & { createdAt?: number };

    if (parsed.createdAt && Date.now() - parsed.createdAt > maxAgeSeconds * 1000) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
