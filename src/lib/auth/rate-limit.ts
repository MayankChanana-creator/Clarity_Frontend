export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface AuthRateLimiter {
  checkLoginLimit(ip: string, email: string): RateLimitResult;
  recordLoginAttempt(ip: string, email: string, success: boolean): void;
  checkSignupLimit(ip: string): RateLimitResult;
  recordSignupAttempt(ip: string): void;
}

interface AttemptRecord {
  timestamps: number[];
}

export class InMemoryRateLimiter implements AuthRateLimiter {
  private loginAttempts = new Map<string, AttemptRecord>();
  private signupAttempts = new Map<string, AttemptRecord>();

  // Login: 5 attempts per 15 min (900,000 ms) per IP+email
  private readonly LOGIN_WINDOW_MS = 15 * 60 * 1000;
  private readonly LOGIN_MAX_ATTEMPTS = 5;

  // Signup: 10 attempts per hour (3,600,000 ms) per IP
  private readonly SIGNUP_WINDOW_MS = 60 * 60 * 1000;
  private readonly SIGNUP_MAX_ATTEMPTS = 10;

  private cleanup(record: AttemptRecord, windowMs: number, now: number): void {
    const cutoff = now - windowMs;
    record.timestamps = record.timestamps.filter((ts) => ts > cutoff);
  }

  checkLoginLimit(ip: string, email: string): RateLimitResult {
    const key = `${ip}:${email.toLowerCase().trim()}`;
    const now = Date.now();
    const record = this.loginAttempts.get(key);

    if (!record) {
      return { allowed: true };
    }

    this.cleanup(record, this.LOGIN_WINDOW_MS, now);

    if (record.timestamps.length >= this.LOGIN_MAX_ATTEMPTS) {
      const oldest = record.timestamps[0];
      const retryAfterSeconds = Math.ceil((oldest + this.LOGIN_WINDOW_MS - now) / 1000);
      return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
    }

    return { allowed: true };
  }

  recordLoginAttempt(ip: string, email: string, success: boolean): void {
    const key = `${ip}:${email.toLowerCase().trim()}`;
    const now = Date.now();

    if (success) {
      // Clear failed attempts on successful login
      this.loginAttempts.delete(key);
      return;
    }

    let record = this.loginAttempts.get(key);
    if (!record) {
      record = { timestamps: [] };
      this.loginAttempts.set(key, record);
    }
    this.cleanup(record, this.LOGIN_WINDOW_MS, now);
    record.timestamps.push(now);
  }

  checkSignupLimit(ip: string): RateLimitResult {
    const now = Date.now();
    const record = this.signupAttempts.get(ip);

    if (!record) {
      return { allowed: true };
    }

    this.cleanup(record, this.SIGNUP_WINDOW_MS, now);

    if (record.timestamps.length >= this.SIGNUP_MAX_ATTEMPTS) {
      const oldest = record.timestamps[0];
      const retryAfterSeconds = Math.ceil((oldest + this.SIGNUP_WINDOW_MS - now) / 1000);
      return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
    }

    return { allowed: true };
  }

  recordSignupAttempt(ip: string): void {
    const now = Date.now();
    let record = this.signupAttempts.get(ip);
    if (!record) {
      record = { timestamps: [] };
      this.signupAttempts.set(ip, record);
    }
    this.cleanup(record, this.SIGNUP_WINDOW_MS, now);
    record.timestamps.push(now);
  }
}

// Export singleton instance, easily replaceable with a Redis-backed implementation
export const rateLimiter: AuthRateLimiter = new InMemoryRateLimiter();
