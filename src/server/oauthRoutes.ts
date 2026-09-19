import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/db';
import {
  getGoogleConfig,
  generatePkce,
  generateRandomString,
  sanitizeNextPath,
  exchangeCodeForTokens,
  verifyGoogleIdToken,
} from '../lib/oauth/google';
import {
  signPayload,
  verifySignedPayload,
  OAUTH_STATE_COOKIE,
  OAUTH_PENDING_COOKIE,
  OAuthStatePayload,
  OAuthPendingPayload,
} from '../lib/oauth/cookies';
import { createSession } from '../lib/auth/sessions';
import { completeGoogleSignupSchema } from '../lib/auth/validation';

const router = Router();
const isProduction = process.env.NODE_ENV === 'production';

// GET /api/oauth/google
router.get('/google', (req: Request, res: Response) => {
  const { clientId, redirectUri } = getGoogleConfig();

  if (!clientId) {
    res.status(503).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Google OAuth Configuration Required</title></head>
        <body style="font-family: sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; line-height: 1.6;">
          <h2 style="color: #C1592B;">Google OAuth Not Configured</h2>
          <p>The <strong>GOOGLE_CLIENT_ID</strong> environment variable is not set. Please add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to your environment settings.</p>
          <p><a href="/login" style="color: #1F2420; text-decoration: underline;">&larr; Return to Log In</a></p>
        </body>
      </html>
    `);
    return;
  }

  const rawIntent = req.query.intent === 'signup' ? 'signup' : 'login';
  const next = sanitizeNextPath(req.query.next as string | undefined);

  const { codeVerifier, codeChallenge } = generatePkce();
  const state = generateRandomString(24);
  const nonce = generateRandomString(24);

  const statePayload: OAuthStatePayload = {
    state,
    codeVerifier,
    nonce,
    intent: rawIntent,
    next,
    createdAt: Date.now(),
  };

  const signedCookieValue = signPayload(statePayload);

  res.cookie(OAUTH_STATE_COOKIE, signedCookieValue, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60 * 1000, // 10 minutes
  });

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('nonce', nonce);
  authUrl.searchParams.set('access_type', 'online');
  authUrl.searchParams.set('prompt', 'select_account');

  res.redirect(authUrl.toString());
});

// GET /api/oauth/google/callback
router.get('/google/callback', async (req: Request, res: Response) => {
  const error = req.query.error as string | undefined;
  if (error) {
    const errorMsg = error === 'access_denied' ? 'Google sign-in was cancelled' : 'Google sign-in failed';
    res.redirect(`/login?error=${encodeURIComponent(errorMsg)}`);
    return;
  }

  const code = req.query.code as string | undefined;
  const returnedState = req.query.state as string | undefined;

  if (!code || !returnedState) {
    res.redirect(`/login?error=${encodeURIComponent('Missing OAuth parameters from Google')}`);
    return;
  }

  const rawStateCookie = req.cookies?.[OAUTH_STATE_COOKIE];
  const stateData = verifySignedPayload<OAuthStatePayload>(rawStateCookie, 10 * 60);

  // Always clear state cookie after use
  res.clearCookie(OAUTH_STATE_COOKIE, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  });

  if (!stateData || stateData.state !== returnedState) {
    res.redirect(`/login?error=${encodeURIComponent('Invalid or expired OAuth state. Please try again.')}`);
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code, stateData.codeVerifier);
    const claims = await verifyGoogleIdToken(tokens.id_token, stateData.nonce);

    const email = claims.email;
    const sub = claims.sub;

    // 1. Check if OAuthAccount already exists with this Google sub
    const existingAccount = await prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'google',
          providerAccountId: sub,
        },
      },
      include: {
        user: true,
      },
    });

    if (existingAccount) {
      // User found via linked account -> log in
      await createSession(existingAccount.userId, req, res);
      const destination = existingAccount.user.onboardingCompletedAt
        ? stateData.next || '/dashboard'
        : '/onboarding';
      res.redirect(destination);
      return;
    }

    // 2. Check if a User exists with the same verified email
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      // Link Google account to this existing user and log in
      await prisma.oAuthAccount.create({
        data: {
          userId: existingUser.id,
          provider: 'google',
          providerAccountId: sub,
          email,
        },
      });

      await createSession(existingUser.id, req, res);
      const destination = existingUser.onboardingCompletedAt
        ? stateData.next || '/dashboard'
        : '/onboarding';
      res.redirect(destination);
      return;
    }

    // 3. Unknown user:
    if (stateData.intent === 'signup') {
      // Direct signup flow -> create User + OAuthAccount + session
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

      await createSession(newUser.id, req, res);
      const destination = stateData.next && stateData.next !== '/dashboard' ? stateData.next : '/onboarding';
      res.redirect(destination);
      return;
    }

    // Unknown user arriving via intent=login:
    // Set a signed 10-minute clarity_oauth_pending cookie, then redirect to /signup?source=google
    const pendingPayload: OAuthPendingPayload = {
      sub,
      email,
      given_name: claims.given_name || claims.name || '',
      family_name: claims.family_name || '',
      next: stateData.next,
      createdAt: Date.now(),
    };

    const signedPendingCookie = signPayload(pendingPayload);

    res.cookie(OAUTH_PENDING_COOKIE, signedPendingCookie, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60 * 1000, // 10 minutes
    });

    res.redirect('/signup?source=google');
  } catch (err: unknown) {
    console.error('Google OAuth error:', (err as Error).message);
    res.redirect(`/login?error=${encodeURIComponent('Failed to authenticate with Google. Please try again.')}`);
  }
});

// GET /api/oauth/pending
router.get('/pending', (req: Request, res: Response) => {
  const rawPendingCookie = req.cookies?.[OAUTH_PENDING_COOKIE];
  const pendingData = verifySignedPayload<OAuthPendingPayload>(rawPendingCookie, 10 * 60);

  if (!pendingData) {
    res.status(404).json({ error: 'No pending Google registration found or session expired.' });
    return;
  }

  res.status(200).json({
    email: pendingData.email,
    firstName: pendingData.given_name || '',
    lastName: pendingData.family_name || '',
  });
});

// POST /api/oauth/google/complete
router.post('/google/complete', async (req: Request, res: Response) => {
  const rawPendingCookie = req.cookies?.[OAUTH_PENDING_COOKIE];
  const pendingData = verifySignedPayload<OAuthPendingPayload>(rawPendingCookie, 10 * 60);

  if (!pendingData) {
    res.status(400).json({
      error: 'Your Google sign-in session has expired. Please sign in with Google again.',
    });
    return;
  }

  const parseResult = completeGoogleSignupSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Validation failed',
      errors: parseResult.error.flatten().fieldErrors,
    });
    return;
  }

  const { firstName, lastName } = parseResult.data;

  try {
    // Check if user or account was created in the meantime
    const existingUser = await prisma.user.findUnique({
      where: { email: pendingData.email },
    });

    let userId: string;

    if (existingUser) {
      userId = existingUser.id;
      // Ensure Google account is linked
      const existingAccount = await prisma.oAuthAccount.findUnique({
        where: {
          provider_providerAccountId: {
            provider: 'google',
            providerAccountId: pendingData.sub,
          },
        },
      });

      if (!existingAccount) {
        await prisma.oAuthAccount.create({
          data: {
            userId,
            provider: 'google',
            providerAccountId: pendingData.sub,
            email: pendingData.email,
          },
        });
      }
    } else {
      const newUser = await prisma.user.create({
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
      userId = newUser.id;
    }

    // Clear pending cookie
    res.clearCookie(OAUTH_PENDING_COOKIE, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
    });

    // Create session
    await createSession(userId, req, res);

    res.status(201).json({
      ok: true,
      next: pendingData.next || '/onboarding',
    });
  } catch (err) {
    console.error('Complete Google signup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
