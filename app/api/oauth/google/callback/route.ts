import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/lib/db';
import { exchangeCodeForTokens, verifyGoogleIdToken } from '@/src/lib/oauth/google';
import { verifySignedPayload, signPayload, OAUTH_STATE_COOKIE, OAUTH_PENDING_COOKIE, OAuthStatePayload, OAuthPendingPayload } from '@/src/lib/oauth/cookies';
import { generateSessionToken, hashSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from '@/src/lib/auth/sessions';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = url.origin;
  const error = url.searchParams.get('error');

  if (error) {
    const msg = error === 'access_denied' ? 'Google sign-in was cancelled' : 'Google sign-in failed';
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(msg)}`);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent('Missing OAuth parameters')}`);
  }

  const stateCookie = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const stateData = verifySignedPayload<OAuthStatePayload>(stateCookie, 600);

  if (!stateData || stateData.state !== state) {
    const res = NextResponse.redirect(`${origin}/login?error=${encodeURIComponent('Invalid or expired OAuth state')}`);
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  }

  try {
    const tokens = await exchangeCodeForTokens(code, stateData.codeVerifier);
    const claims = await verifyGoogleIdToken(tokens.id_token, stateData.nonce);
    const { sub, email } = claims;

    const existingAccount = await prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider: 'google', providerAccountId: sub } },
      include: { user: true },
    });

    const createSessionForUser = async (userId: string, nextPath: string) => {
      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
      await prisma.session.create({
        data: {
          userId,
          tokenHash,
          expiresAt,
          userAgent: req.headers.get('user-agent')?.slice(0, 500) || null,
          ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1',
        },
      });

      const res = NextResponse.redirect(`${origin}${nextPath}`);
      res.cookies.set(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        expires: expiresAt,
      });
      res.cookies.delete(OAUTH_STATE_COOKIE);
      return res;
    };

    if (existingAccount) {
      const nextPath = existingAccount.user.onboardingCompletedAt ? stateData.next || '/dashboard' : '/onboarding';
      return await createSessionForUser(existingAccount.userId, nextPath);
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      await prisma.oAuthAccount.create({
        data: {
          userId: existingUser.id,
          provider: 'google',
          providerAccountId: sub,
          email,
        },
      });
      const nextPath = existingUser.onboardingCompletedAt ? stateData.next || '/dashboard' : '/onboarding';
      return await createSessionForUser(existingUser.id, nextPath);
    }

    // Unknown user
    if (stateData.intent === 'signup') {
      const newUser = await prisma.user.create({
        data: {
          firstName: claims.given_name || claims.name || 'Student',
          lastName: claims.family_name || '',
          email,
          passwordHash: null,
          onboardingCompletedAt: null,
          accounts: {
            create: {
              provider: 'google',
              providerAccountId: sub,
              email,
            },
          },
        },
      });
      const nextPath = stateData.next && stateData.next !== '/dashboard' ? stateData.next : '/onboarding';
      return await createSessionForUser(newUser.id, nextPath);
    }

    // Unknown user arrived via intent=login -> pending flow
    const pendingPayload: OAuthPendingPayload = {
      sub,
      email,
      given_name: claims.given_name || claims.name || '',
      family_name: claims.family_name || '',
      next: stateData.next,
      createdAt: Date.now(),
    };

    const res = NextResponse.redirect(`${origin}/signup?source=google`);
    res.cookies.set(OAUTH_PENDING_COOKIE, signPayload(pendingPayload), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  } catch (err: unknown) {
    const res = NextResponse.redirect(`${origin}/login?error=${encodeURIComponent('Failed to authenticate with Google')}`);
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  }
}
