import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { MandateProvider } from "./context/MandateContext";
import { AppShell } from "./components/layout/AppShell";
import { LandingPage } from "./pages/LandingPage";
import { MandatePage } from "./pages/MandatePage";
import { ShopPage } from "./pages/ShopPage";
import { AuditPage } from "./pages/AuditPage";
import { LoginPage } from "./pages/LoginPage";

export default function App() {
  return (
    <AuthProvider>
      <MandateProvider>
        <Routes>
          {/* Landing Page */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/overview" element={<LandingPage />} />
          <Route path="/landing" element={<LandingPage />} />

          {/* Console / Operations Pages */}
          <Route
            path="/login"
            element={
              <AppShell>
                <LoginPage />
              </AppShell>
            }
          />
          <Route
            path="/mandate"
            element={
              <AppShell>
                <MandatePage />
              </AppShell>
            }
          />
          <Route
            path="/shop"
            element={
              <AppShell>
                <ShopPage />
              </AppShell>
            }
          />
          <Route
            path="/audit"
            element={
              <AppShell>
                <AuditPage />
              </AppShell>
            }
          />
          <Route
            path="/audit/:sessionId"
            element={
              <AppShell>
                <AuditPage />
              </AppShell>
            }
          />

          {/* Catch-all fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </MandateProvider>
    </AuthProvider>
  );
}
