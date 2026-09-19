import type { Request, Response, NextFunction } from 'express';

export function verifyOrigin(req: Request, res: Response, next: NextFunction) {
  // Only verify state-modifying requests
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.headers['origin'];
    const host = req.headers['host'];

    // In development or when origin is absent, allow same-host
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const appUrl = process.env.APP_URL ? new URL(process.env.APP_URL) : null;

        // Check if origin matches APP_URL or current host header
        const hostMatches = host && (originUrl.host === host || originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1');
        const appMatches = appUrl && originUrl.origin === appUrl.origin;

        if (!hostMatches && !appMatches) {
          res.status(403).json({ error: 'Origin check failed' });
          return;
        }
      } catch {
        res.status(403).json({ error: 'Invalid origin header' });
        return;
      }
    }
  }

  // Ensure auth responses are never cached
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  next();
}
