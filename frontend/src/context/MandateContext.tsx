import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { Mandate } from "../lib/types";
import { listMandates, revokeMandate as apiRevokeMandate } from "../lib/api";
import { useAuth } from "./AuthContext";

interface MandateContextType {
  mandates: Mandate[];
  activeMandate: Mandate | null;
  selectedSessionId: string | null;
  loading: boolean;
  error: string | null;
  setActiveMandate: (mandate: Mandate | null) => void;
  setSelectedSessionId: (sessionId: string | null) => void;
  refreshMandates: () => Promise<void>;
  revoke: (mandateId: string) => Promise<boolean>;
}

const MandateContext = createContext<MandateContextType | undefined>(undefined);

export const MandateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [activeMandate, setActiveMandate] = useState<Mandate | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refreshMandates = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listMandates();
      setMandates(list);
      setError(null);

      // If active mandate isn't set or no longer exists, pick the first non-revoked or first available
      if (list.length > 0) {
        if (!activeMandate) {
          const nonRevoked = list.find((m) => !m.revoked) || list[0];
          setActiveMandate(nonRevoked);
          setSelectedSessionId(nonRevoked.session_id || null);
        } else {
          const updated = list.find((m) => m.mandate_id === activeMandate.mandate_id);
          if (updated) {
            setActiveMandate(updated);
            setSelectedSessionId(updated.session_id || null);
          } else {
            setActiveMandate(list[0]);
            setSelectedSessionId(list[0].session_id || null);
          }
        }
      } else {
        setActiveMandate(null);
        setSelectedSessionId(null);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load mandates");
    } finally {
      setLoading(false);
    }
  }, [activeMandate]);

  // Refresh when auth state changes
  useEffect(() => {
    refreshMandates();
  }, [user]);

  const revoke = async (mandateId: string): Promise<boolean> => {
    try {
      await apiRevokeMandate(mandateId);
      await refreshMandates();
      return true;
    } catch (err: any) {
      setError(err?.message || "Revoke action failed");
      return false;
    }
  };

  return (
    <MandateContext.Provider
      value={{
        mandates,
        activeMandate,
        selectedSessionId,
        loading,
        error,
        setActiveMandate,
        setSelectedSessionId,
        refreshMandates,
        revoke,
      }}
    >
      {children}
    </MandateContext.Provider>
  );
};

export function useMandate(): MandateContextType {
  const ctx = useContext(MandateContext);
  if (!ctx) {
    throw new Error("useMandate must be used within a MandateProvider");
  }
  return ctx;
}
