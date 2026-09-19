import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../src/lib/db';
import { loginSchema } from '../../../../src/lib/auth/validation';
import { verifyPassword, runDummyPasswordHash, hashPassword } from '../../../../src/lib/auth/passwords';
import { rateLimiter } from '../../../../src/lib/auth/rate-limit';
import { generateSessionToken, hashSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from '../../../../src/lib/auth/sessions';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
  const body = await req.json().catch(() => ({}));
  const emailCandidate = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

  const rate = rateLimiter.checkLoginLimit(ip, emailCandidate);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please wait a few minutes before trying again.', retryAfterSeconds: rate.retryAfterSeconds },
      { status: 429 }
    );
  }

  const parse = loginSchema.safeParse(body);
  if (!parse.success) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 400 });
  }

  const { email, password } = parse.data;
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    await runDummyPasswordHash();
    rateLimiter.recordLoginAttempt(ip, email, false);
    return NextResponse.json({
      code: 'NO_ACCOUNT',
      message: 'No account found for that email. Create one below.',
      email,
    });
  }

  if (!user.passwordHash) {
    return NextResponse.json({
      code: 'USE_GOOGLE',
      message: 'This account uses Google sign-in',
    });
  }

  const { valid, needsRehash } = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    rateLimiter.recordLoginAttempt(ip, email, false);
    return NextResponse.json(
      { error: 'Incorrect email or password', code: 'INVALID_CREDENTIALS' },
      { status: 401 }
    );
  }

  rateLimiter.recordLoginAttempt(ip, email, true);

  if (needsRehash) {
    const newHash = await hashPassword(password);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } }).catch(() => {});
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
      ip,
    },
  });

  const next = user.onboardingCompletedAt ? '/dashboard' : '/onboarding';
  const response = NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      onboardingCompletedAt: user.onboardingCompletedAt,
    },
    next,
  });

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
