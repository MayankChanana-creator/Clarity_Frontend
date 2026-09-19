import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../src/lib/db';
import { hashSessionToken, SESSION_COOKIE_NAME } from '../../../../src/lib/auth/sessions';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const tokenHash = hashSessionToken(token);
    await prisma.session.deleteMany({ where: { tokenHash } }).catch(() => {});
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE_NAME);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
