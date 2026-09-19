import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../src/lib/db';
import { signupSchema } from '../../../../src/lib/auth/validation';
import { hashPassword } from '../../../../src/lib/auth/passwords';
import { rateLimiter } from '../../../../src/lib/auth/rate-limit';
import { generateSessionToken, hashSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from '../../../../src/lib/auth/sessions';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
  const rate = rateLimiter.checkSignupLimit(ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many signup attempts. Please try again later.', retryAfterSeconds: rate.retryAfterSeconds },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const parse = signupSchema.safeParse(body);
  if (!parse.success) {
    return NextResponse.json(
      { error: 'Validation failed', errors: parse.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { firstName, lastName, email, password } = parse.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: 'An account with this email already exists', code: 'EMAIL_EXISTS' },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      firstName,
      lastName,
      email,
      passwordHash,
      onboardingCompletedAt: null,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      onboardingCompletedAt: true,
    },
  });

  rateLimiter.recordSignupAttempt(ip);

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);

  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
      userAgent: req.headers.get('user-agent')?.slice(0, 500) || null,
      ip,
    },
  });

  const response = NextResponse.json({ ok: true, user, next: '/onboarding' }, { status: 201 });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
