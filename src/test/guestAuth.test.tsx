import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { SKIP_SIGNUP_TARGET } from '../lib/routes';
import { isAuthEnforced } from '../lib/auth/authConfig';
import { ProtectedRoute } from '../components/auth/ProtectedRoute';
import { SignupPage } from '../pages/SignupPage';
import { AuthContext } from '../lib/auth/AuthContext';
import { middleware } from '../../middleware';
import { NextRequest } from 'next/server';

describe('Guest Access & Skip Signup Flow', () => {
  const originalEnv = process.env.NEXT_PUBLIC_ENFORCE_AUTH;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_ENFORCE_AUTH;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NEXT_PUBLIC_ENFORCE_AUTH = originalEnv;
    } else {
      delete process.env.NEXT_PUBLIC_ENFORCE_AUTH;
    }
  });

  describe('SKIP_SIGNUP_TARGET Constant', () => {
    it('targets the original 3-step onboarding flow at /onboarding', () => {
      expect(SKIP_SIGNUP_TARGET).toBe('/onboarding');
    });
  });

  describe('Signup Page Skip Option', () => {
    it('renders the "Skip for now" link with the exact target href and helper text', () => {
      const mockAuthValue = {
        user: null,
        loading: false,
        refreshSession: vi.fn(),
        logout: vi.fn(),
        setUser: vi.fn(),
      };

      const html = renderToString(
        <AuthContext.Provider value={mockAuthValue}>
          <MemoryRouter initialEntries={['/signup']}>
            <SignupPage />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      // Verify the skip link exists with id and exact href
      expect(html).toContain('id="link-skip-signup"');
      expect(html).toContain(`href="${SKIP_SIGNUP_TARGET}"`);
      expect(html).toContain('Skip for now');

      // Verify helper text
      expect(html).toContain('You can create your account later. Until then your progress is saved on this device.');

      // Verify primary submit button is also present
      expect(html).toContain('id="btn-signup-submit"');
      expect(html).toContain('Create Account');

      // Verify "Already have an account? Log in" switcher is intact
      expect(html).toContain('Already have an account?');
      expect(html).toContain('href="/login"');
    });
  });

  describe('Route Protection Guard (isAuthEnforced & ProtectedRoute)', () => {
    it('isAuthEnforced returns false by default when unset', () => {
      delete process.env.NEXT_PUBLIC_ENFORCE_AUTH;
      expect(isAuthEnforced()).toBe(false);
    });

    it('isAuthEnforced returns false when set to "false"', () => {
      process.env.NEXT_PUBLIC_ENFORCE_AUTH = 'false';
      expect(isAuthEnforced()).toBe(false);
    });

    it('isAuthEnforced returns true only when explicitly set to "true"', () => {
      process.env.NEXT_PUBLIC_ENFORCE_AUTH = 'true';
      expect(isAuthEnforced()).toBe(true);
    });

    it('ProtectedRoute does nothing (renders children) when NEXT_PUBLIC_ENFORCE_AUTH is off', () => {
      process.env.NEXT_PUBLIC_ENFORCE_AUTH = 'false';

      // Unauthenticated context (user = null)
      const mockAuthValue = {
        user: null,
        loading: false,
        refreshSession: vi.fn(),
        logout: vi.fn(),
        setUser: vi.fn(),
      };

      const html = renderToString(
        <AuthContext.Provider value={mockAuthValue}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <ProtectedRoute>
              <div id="protected-content">Dashboard Protected Content For Guest</div>
            </ProtectedRoute>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      // Children must render directly without redirection
      expect(html).toContain('id="protected-content"');
      expect(html).toContain('Dashboard Protected Content For Guest');
    });

    it('ProtectedRoute redirects to /login when NEXT_PUBLIC_ENFORCE_AUTH is "true" and user is null', () => {
      process.env.NEXT_PUBLIC_ENFORCE_AUTH = 'true';

      const mockAuthValue = {
        user: null,
        loading: false,
        refreshSession: vi.fn(),
        logout: vi.fn(),
        setUser: vi.fn(),
      };

      const html = renderToString(
        <AuthContext.Provider value={mockAuthValue}>
          <MemoryRouter initialEntries={['/dashboard']}>
            <ProtectedRoute>
              <div id="protected-content">Dashboard Protected Content</div>
            </ProtectedRoute>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      // Children should not render because user was redirected
      expect(html).not.toContain('id="protected-content"');
    });

    it('middleware is a no-op when NEXT_PUBLIC_ENFORCE_AUTH is unset or "false"', () => {
      process.env.NEXT_PUBLIC_ENFORCE_AUTH = 'false';

      const req = new NextRequest('http://localhost:3000/dashboard');
      const response = middleware(req);

      // Should return next response (no redirect)
      expect(response.status).not.toBe(307);
      expect(response.status).not.toBe(302);
      expect(response.headers.get('location')).toBeNull();
    });

    it('middleware redirects to /login when NEXT_PUBLIC_ENFORCE_AUTH is "true" and no cookie present', () => {
      process.env.NEXT_PUBLIC_ENFORCE_AUTH = 'true';

      const req = new NextRequest('http://localhost:3000/dashboard');
      const response = middleware(req);

      expect(response.status).toBe(307); // NextResponse.redirect default status
      expect(response.headers.get('location')).toBe('http://localhost:3000/login?next=%2Fdashboard');
    });
  });
});
