import { NextRequest, NextResponse } from 'next/server';
import { getGoogleConfig, generatePkce, generateRandomString, sanitizeNextPath } from '../../../../src/lib/oauth/google';
import { signPayload, OAUTH_STATE_COOKIE, OAuthStatePayload } from '../../../../src/lib/oauth/cookies';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { clientId, redirectUri } = getGoogleConfig();
  if (!clientId) {
    return new NextResponse('GOOGLE_CLIENT_ID is not configured', { status: 503 });
  }

  const url = new URL(req.url);
  const intent = url.searchParams.get('intent') === 'signup' ? 'signup' : 'login';
  const next = sanitizeNextPath(url.searchParams.get('next'));

  const { codeVerifier, codeChallenge } = generatePkce();
  const state = generateRandomString(24);
  const nonce = generateRandomString(24);

  const statePayload: OAuthStatePayload = {
    state,
    codeVerifier,
    nonce,
    intent,
    next,
    createdAt: Date.now(),
  };

  const signedCookie = signPayload(statePayload);

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('nonce', nonce);

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set(OAUTH_STATE_COOKIE, signedCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return response;
}
