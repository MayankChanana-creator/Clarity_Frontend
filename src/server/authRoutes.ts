import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/db';
import { hashPassword, verifyPassword, runDummyPasswordHash } from '../lib/auth/passwords';
import { signupSchema, loginSchema } from '../lib/auth/validation';
import { createSession, destroySession, getSession } from '../lib/auth/sessions';
import { rateLimiter } from '../lib/auth/rate-limit';

const router = Router();

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

// POST /api/auth/signup
router.post('/signup', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const rateCheck = rateLimiter.checkSignupLimit(ip);
  if (!rateCheck.allowed) {
    res.status(429).json({
      error: 'Too many signup attempts. Please try again later.',
      retryAfterSeconds: rateCheck.retryAfterSeconds,
    });
    return;
  }

  const parseResult = signupSchema.safeParse(req.body);
  if (!parseResult.success) {
    const formattedErrors: Record<string, string> = {};
    for (const issue of parseResult.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && !formattedErrors[field]) {
        formattedErrors[field] = issue.message;
      }
    }
    res.status(400).json({
      error: 'Validation failed',
      errors: formattedErrors,
    });
    return;
  }

  const { firstName, lastName, email, password } = parseResult.data;

  try {
    const existing = await prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      res.status(409).json({
        error: 'An account with this email already exists',
        code: 'EMAIL_EXISTS',
        errors: {
          email: 'An account with this email already exists. Please log in.',
        },
      });
      return;
    }

    // Hash with 600,000 iterations PBKDF2-HMAC-SHA256
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

    // Create session and set clarity_session cookie
    await createSession(user.id, req, res);

    res.status(201).json({
      ok: true,
      user,
      next: '/onboarding',
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  const emailCandidate = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

  const rateCheck = rateLimiter.checkLoginLimit(ip, emailCandidate);
  if (!rateCheck.allowed) {
    res.status(429).json({
      error: 'Too many login attempts. Please wait a few minutes before trying again.',
      retryAfterSeconds: rateCheck.retryAfterSeconds,
    });
    return;
  }

  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Invalid email or password format',
      errors: {
        email: parseResult.error.issues.find((i) => i.path[0] === 'email')?.message,
        password: parseResult.error.issues.find((i) => i.path[0] === 'password')?.message,
      },
    });
    return;
  }

  const { email, password } = parseResult.data;

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Execute dummy hash to equalize timing
      await runDummyPasswordHash();
      rateLimiter.recordLoginAttempt(ip, email, false);

      res.status(200).json({
        code: 'NO_ACCOUNT',
        message: 'No account found for that email. Create one below.',
        email,
      });
      return;
    }

    if (!user.passwordHash) {
      // User registered via Google OAuth and has no password
      res.status(200).json({
        code: 'USE_GOOGLE',
        message: 'This account uses Google sign-in',
      });
      return;
    }

    const { valid, needsRehash } = await verifyPassword(password, user.passwordHash);

    if (!valid) {
      rateLimiter.recordLoginAttempt(ip, email, false);
      res.status(401).json({
        error: 'Incorrect email or password',
        code: 'INVALID_CREDENTIALS',
      });
      return;
    }

    // Success
    rateLimiter.recordLoginAttempt(ip, email, true);

    // Rehash if iteration count is lower than current
    if (needsRehash) {
      const newHash = await hashPassword(password);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash },
      }).catch(() => {});
    }

    // Always issue a fresh session
    await createSession(user.id, req, res);

    const next = user.onboardingCompletedAt ? '/dashboard' : '/onboarding';

    res.status(200).json({
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
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req: Request, res: Response) => {
  try {
    await destroySession(req, res);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/session
router.get('/session', async (req: Request, res: Response) => {
  try {
    const sessionData = await getSession(req, res);
    if (!sessionData) {
      res.status(200).json({ user: null });
      return;
    }

    res.status(200).json({
      user: {
        id: sessionData.user.id,
        firstName: sessionData.user.firstName,
        lastName: sessionData.user.lastName,
        email: sessionData.user.email,
        onboardingCompletedAt: sessionData.user.onboardingCompletedAt,
      },
    });
  } catch (err) {
    console.error('Session retrieval error:', err);
    res.status(500).json({ user: null });
  }
});

export default router;
