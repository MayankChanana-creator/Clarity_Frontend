import { NextRequest, NextResponse } from 'next/server';
import { verifySignedPayload, OAUTH_PENDING_COOKIE, OAuthPendingPayload } from '../../../../src/lib/oauth/cookies';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const pendingCookie = req.cookies.get(OAUTH_PENDING_COOKIE)?.value;
  const pendingData = verifySignedPayload<OAuthPendingPayload>(pendingCookie, 600);

  if (!pendingData) {
    return NextResponse.json({ error: 'No pending Google registration found' }, { status: 404 });
  }

  return NextResponse.json({
    email: pendingData.email,
    firstName: pendingData.given_name || '',
    lastName: pendingData.family_name || '',
  });
}
