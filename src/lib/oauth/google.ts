import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.APP_URL?.replace(/\/+$/, '') || 'http://localhost:3000';

  return {
    clientId,
    clientSecret,
    appUrl,
    redirectUri: `${appUrl}/api/oauth/google/callback`,
  };
}

export function generatePkce() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function generateRandomString(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Validate that next path is a safe, same-origin relative URL.
 */
export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next || typeof next !== 'string') {
    return '/dashboard';
  }
  const trimmed = next.trim();
  // Must start with a single slash and not contain protocol or double slashes
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\') && !trimmed.includes('://')) {
    return trimmed;
  }
  return '/dashboard';
}

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs')
);

export interface GoogleIdTokenClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
  nonce?: string;
}

/**
 * Exchanges the authorization code for tokens at Google's token endpoint.
 */
export async function exchangeCodeForTokens(code: string, codeVerifier: string) {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig();

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) are not configured.');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google token exchange failed: ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    id_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };

  return data;
}

/**
 * Verifies the Google ID Token with jose against Google's JWKS.
 * Checks signature, iss, aud, exp, nonce, and email_verified.
 */
export async function verifyGoogleIdToken(idToken: string, expectedNonce: string): Promise<GoogleIdTokenClaims> {
  const { clientId } = getGoogleConfig();

  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured.');
  }

  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: clientId,
  });

  if (!payload.email || typeof payload.email !== 'string') {
    throw new Error('Google ID token is missing email.');
  }

  if (payload.nonce !== expectedNonce) {
    throw new Error('Invalid OAuth nonce verification.');
  }

  const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
  if (!emailVerified) {
    throw new Error('Google account email is not verified.');
  }

  return {
    sub: payload.sub as string,
    email: payload.email.toLowerCase().trim(),
    email_verified: emailVerified,
    given_name: payload.given_name as string | undefined,
    family_name: payload.family_name as string | undefined,
    name: payload.name as string | undefined,
    picture: payload.picture as string | undefined,
    nonce: payload.nonce as string | undefined,
  };
}
