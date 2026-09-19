import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import App from './App.tsx';
import { OnboardingFlow } from './onboarding/OnboardingFlow.tsx';
import { DashboardView } from './dashboard/DashboardView.tsx';
import { DashboardGraphPage } from './app/(dashboard)/graph/page.tsx';
import { GraphDemoPage } from './app/graph-demo/page.tsx';
import { DashboardDemoPage } from './app/dashboard-demo/page.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { SignupPage } from './pages/SignupPage.tsx';
import MockOAInstructionsPage from '../app/mock-oa/page.tsx';
import MockOASessionPage from '../app/mock-oa/session/page.tsx';
import MockOAResultPage from '../app/mock-oa/result/page.tsx';
import { AuthProvider } from './lib/auth/AuthContext.tsx';
import { ProtectedRoute } from './components/auth/ProtectedRoute.tsx';
import { GuestOnlyRoute } from './components/auth/GuestOnlyRoute.tsx';
import './index.css';

const GraphRedirect: React.FC = () => {
  const location = useLocation();
  return <Navigate to={`/dashboard/graph${location.search}`} replace />;
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route
            path="/login"
            element={
              <GuestOnlyRoute>
                <LoginPage />
              </GuestOnlyRoute>
            }
          />
          <Route
            path="/signup"
            element={
              <GuestOnlyRoute>
                <SignupPage />
              </GuestOnlyRoute>
            }
          />
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <OnboardingFlow />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardView />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/graph"
            element={
              <ProtectedRoute>
                <DashboardGraphPage />
              </ProtectedRoute>
            }
          />
          <Route path="/graph" element={<GraphRedirect />} />
          <Route path="/mock-oa" element={<MockOAInstructionsPage />} />
          <Route path="/mock-oa/session" element={<MockOASessionPage />} />
          <Route path="/mock-oa/result" element={<MockOAResultPage />} />
          <Route path="/dashboard-demo" element={<DashboardDemoPage />} />
          <Route path="/graph-demo" element={<GraphDemoPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);


