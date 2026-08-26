import React, { createContext, useContext, useEffect, useState } from "react";
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, googleProvider, db } from "../lib/firebase";
import { bindTokenToUser, clearToken } from "../lib/token";

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: "user" | "admin";
  createdAt?: any;
  lastLoginAt?: any;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, name: string) => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Sync user doc in Firestore on login
  const syncUserProfile = async (firebaseUser: User) => {
    try {
      const userRef = doc(db, "users", firebaseUser.uid);
      const snap = await getDoc(userRef);

      if (!snap.exists()) {
        const newProfile: UserProfile = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "User",
          photoURL: firebaseUser.photoURL,
          role: "user",
        };
        await setDoc(userRef, {
          ...newProfile,
          createdAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        });
        setProfile(newProfile);
      } else {
        const existingData = snap.data() as UserProfile;
        await setDoc(userRef, { lastLoginAt: serverTimestamp() }, { merge: true });
        setProfile(existingData);
      }
    } catch (err) {
      console.error("Failed to sync user profile with Firestore:", err);
      // Fallback local memory profile
      setProfile({
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName || "User",
        photoURL: firebaseUser.photoURL,
        role: "user",
      });
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Bind the stable backend bearer token for this user BEFORE anything
        // (MandateContext) reacts to the user change and starts fetching, so
        // every backend call uses the user's own identity, not an anonymous one.
        await bindTokenToUser(firebaseUser.uid);
        setUser(firebaseUser);
        await syncUserProfile(firebaseUser);
      } else {
        // Anonymous (not logged in): do NOT clear the token here — this branch
        // also fires on every initial load before login, and the anonymous
        // bearer token is a stable per-browser identity that owns the user's
        // mandates. Clearing it here would orphan them (403 "not your session").
        // The token is only dropped on an explicit logOut() below.
        setUser(firebaseUser);
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    const result = await signInWithPopup(auth, googleProvider);
    if (result.user) {
      await syncUserProfile(result.user);
    }
  };

  const signInWithEmail = async (email: string, pass: string) => {
    const result = await signInWithEmailAndPassword(auth, email, pass);
    if (result.user) {
      await syncUserProfile(result.user);
    }
  };

  const signUpWithEmail = async (email: string, pass: string, name: string) => {
    const result = await createUserWithEmailAndPassword(auth, email, pass);
    if (result.user) {
      await updateProfile(result.user, { displayName: name });
      const userRef = doc(db, "users", result.user.uid);
      const newProfile: UserProfile = {
        uid: result.user.uid,
        email: result.user.email,
        displayName: name,
        photoURL: null,
        role: "user",
      };
      await setDoc(userRef, {
        ...newProfile,
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      });
      setProfile(newProfile);
    }
  };

  const logOut = async () => {
    await signOut(auth);
    clearToken();
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        logOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
