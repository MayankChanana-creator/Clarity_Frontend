import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { prisma } from '../db';
import type { User, Session } from '@prisma/client';

export const SESSION_COOKIE_NAME = 'clarity_session';
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SLIDING_WINDOW_MS = 15 * 24 * 60 * 60 * 1000; // 15 days

export interface AuthenticatedUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  onboardingCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionWithUser {
  session: Session;
  user: AuthenticatedUser;
}

/**
 * Compute SHA-256 hex hash of the raw session token.
 */
export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a cryptographically secure 32-byte session token (URL-safe base64).
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Create a new session for a user, write it to the database, and set the HttpOnly cookie.
 */
export async function createSession(
  userId: string,
  req: Request,
  res: Response
): Promise<{ token: string; session: Session }> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_MS);

  const userAgent = req.headers['user-agent']?.slice(0, 500) || null;
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || null;

  // Create session in DB
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      createdAt: now,
      lastUsedAt: now,
      userAgent,
      ip,
    },
  });

  // Set HttpOnly cookie
  setSessionCookie(res, token, expiresAt);

  // Lazily clean up expired sessions for this user or globally in the background
  cleanupExpiredSessions().catch(() => {});

  return { token, session };
}

/**
 * Sets the clarity_session cookie on the response.
 */
export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

/**
 * Clears the clarity_session cookie on the response.
 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

/**
 * Retrieve session and user from raw session token.
 * Extends session if under 15 days remain (sliding expiry).
 */
export async function getSession(req: Request, res?: Response): Promise<SessionWithUser | null> {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token || typeof token !== 'string') {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const now = new Date();

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
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!session) {
    if (res) clearSessionCookie(res);
    return null;
  }

  // If expired, delete and clear cookie
  if (session.expiresAt.getTime() <= now.getTime()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    if (res) clearSessionCookie(res);
    return null;
  }

  // Sliding window check: extend if under 15 days remain
  const msRemaining = session.expiresAt.getTime() - now.getTime();
  if (msRemaining < SLIDING_WINDOW_MS) {
    const newExpiresAt = new Date(now.getTime() + SESSION_MAX_AGE_MS);
    await prisma.session.update({
      where: { id: session.id },
      data: {
        expiresAt: newExpiresAt,
        lastUsedAt: now,
      },
    }).catch(() => {});

    session.expiresAt = newExpiresAt;
    session.lastUsedAt = now;

    if (res) {
      setSessionCookie(res, token, newExpiresAt);
    }
  } else {
    // Periodically touch lastUsedAt (e.g. if > 1 hour since last touch)
    if (now.getTime() - session.lastUsedAt.getTime() > 60 * 60 * 1000) {
      await prisma.session.update({
        where: { id: session.id },
        data: { lastUsedAt: now },
      }).catch(() => {});
    }
  }

  return {
    session,
    user: session.user,
  };
}

/**
 * Destroy a session by token and remove cookie.
 */
export async function destroySession(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (token && typeof token === 'string') {
    const tokenHash = hashSessionToken(token);
    await prisma.session.deleteMany({
      where: { tokenHash },
    }).catch(() => {});
  }
  clearSessionCookie(res);
}

/**
 * Asynchronously cleans up expired sessions.
 */
export async function cleanupExpiredSessions(): Promise<void> {
  try {
    await prisma.session.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
  } catch {
    // Ignore errors during lazy cleanup
  }
}
