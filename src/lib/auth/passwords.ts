import crypto from 'node:crypto';

export const CURRENT_ITERATIONS = 600000;
export const KEY_LENGTH = 32;
export const SALT_LENGTH = 16;
export const DIGEST = 'sha256';

export const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'admin123',
  'welcome1',
  'welcome123',
  'letmein123',
  'clarity123',
  'iloveyou',
  'monkey123',
  'dragon123',
  'master123',
  'sunshine1',
  'princess1',
]);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.trim().toLowerCase());
}

/**
 * Hash a password using PBKDF2-HMAC-SHA256 with 600,000 iterations.
 * Format: pbkdf2-sha256$<iterations>$<salt_b64>$<hash_b64>
 */
export async function hashPassword(password: string, iterations = CURRENT_ITERATIONS): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const hash = await new Promise<Buffer>((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, KEY_LENGTH, DIGEST, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });

  return `pbkdf2-${DIGEST}$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * Verify a password against a stored hash string.
 * Uses timingSafeEqual to avoid timing attacks.
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<{ valid: boolean; needsRehash: boolean }> {
  try {
    const parts = storedHash.split('$');
    if (parts.length !== 4) {
      return { valid: false, needsRehash: false };
    }

    const [algorithm, iterationsStr, saltB64, hashB64] = parts;
    if (algorithm !== `pbkdf2-${DIGEST}`) {
      return { valid: false, needsRehash: false };
    }

    const iterations = parseInt(iterationsStr, 10);
    if (Number.isNaN(iterations) || iterations <= 0) {
      return { valid: false, needsRehash: false };
    }

    const salt = Buffer.from(saltB64, 'base64');
    const expectedHash = Buffer.from(hashB64, 'base64');

    const actualHash = await new Promise<Buffer>((resolve, reject) => {
      crypto.pbkdf2(password, salt, iterations, expectedHash.length, DIGEST, (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    });

    const valid =
      actualHash.length === expectedHash.length &&
      crypto.timingSafeEqual(actualHash, expectedHash);

    const needsRehash = valid && iterations < CURRENT_ITERATIONS;

    return { valid, needsRehash };
  } catch {
    return { valid: false, needsRehash: false };
  }
}

/**
 * Executes a dummy PBKDF2 hash with identical parameters so timing does not leak
 * whether an email exists when a login fails.
 */
export async function runDummyPasswordHash(): Promise<void> {
  const dummySalt = Buffer.alloc(SALT_LENGTH, 0x5a);
  await new Promise<Buffer>((resolve) => {
    crypto.pbkdf2('dummy-password-timing-defense', dummySalt, CURRENT_ITERATIONS, KEY_LENGTH, DIGEST, (err, derivedKey) => {
      resolve(derivedKey);
    });
  });
}
