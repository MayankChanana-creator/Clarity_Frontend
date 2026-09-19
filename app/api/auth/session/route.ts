import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../src/lib/db';
import { hashSessionToken, SESSION_COOKIE_NAME } from '../../../../src/lib/auth/sessions';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    const res = NextResponse.json({ user: null });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }

  const tokenHash = hashSessionToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          onboardingCompletedAt: true,
        },
      },
    },
  });

  if (!session || session.expiresAt.getTime() <= Date.now()) {
    const res = NextResponse.json({ user: null });
    res.cookies.delete(SESSION_COOKIE_NAME);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }

  const res = NextResponse.json({ user: session.user });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
