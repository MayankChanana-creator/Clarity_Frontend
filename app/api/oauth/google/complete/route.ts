import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/lib/db';
import { verifySignedPayload, OAUTH_PENDING_COOKIE, OAuthPendingPayload } from '@/src/lib/oauth/cookies';
import { completeGoogleSignupSchema } from '@/src/lib/auth/validation';
import { generateSessionToken, hashSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from '@/src/lib/auth/sessions';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const pendingCookie = req.cookies.get(OAUTH_PENDING_COOKIE)?.value;
  const pendingData = verifySignedPayload<OAuthPendingPayload>(pendingCookie, 600);

  if (!pendingData) {
    return NextResponse.json({ error: 'Google registration session has expired. Please sign in again.' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parse = completeGoogleSignupSchema.safeParse(body);
  if (!parse.success) {
    return NextResponse.json({ error: 'Validation failed', errors: parse.error.flatten().fieldErrors }, { status: 400 });
  }

  const { firstName, lastName } = parse.data;
  let user = await prisma.user.findUnique({ where: { email: pendingData.email } });

  if (user) {
    const existingAccount = await prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider: 'google', providerAccountId: pendingData.sub } },
    });
    if (!existingAccount) {
      await prisma.oAuthAccount.create({
        data: {
          userId: user.id,
          provider: 'google',
          providerAccountId: pendingData.sub,
          email: pendingData.email,
        },
      });
    }
  } else {
    user = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email: pendingData.email,
        passwordHash: null,
        onboardingCompletedAt: null,
        accounts: {
          create: {
            provider: 'google',
            providerAccountId: pendingData.sub,
            email: pendingData.email,
          },
        },
      },
    });
  }

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);

  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
      userAgent: req.headers.get('user-agent')?.slice(0, 500) || null,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1',
    },
  });

  const response = NextResponse.json({ ok: true, next: pendingData.next || '/onboarding' }, { status: 201 });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
  response.cookies.delete(OAUTH_PENDING_COOKIE);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
