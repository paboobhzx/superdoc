import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
} from "amazon-cognito-identity-js";
import { api } from "../lib/api";

const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID || "";
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || "";

const EMAIL_STORAGE_KEY = "superdoc_email";

const AuthContext = createContext(null);

function isConfigured() {
  return Boolean(USER_POOL_ID && CLIENT_ID);
}

function getPool() {
  return new CognitoUserPool({
    UserPoolId: USER_POOL_ID,
    ClientId: CLIENT_ID,
  });
}

function writeEmail(email) {
  try {
    if (!email) sessionStorage.removeItem(EMAIL_STORAGE_KEY);
    else sessionStorage.setItem(EMAIL_STORAGE_KEY, email);
  } catch {
    // ignore
  }
}

function readEmail() {
  try {
    return sessionStorage.getItem(EMAIL_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [email, setEmail] = useState(() => readEmail());
  const configured = isConfigured();

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((data) => {
        if (cancelled) return;
        setUser(data.user || null);
        if (data.user?.email) setEmail(data.user.email);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setAuthChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    writeEmail(email);
  }, [email]);

  const value = useMemo(() => {
    async function signIn(nextEmail, password) {
      if (!nextEmail || !password) throw new Error("Email and password are required.");

      const result = await api.login({ email: nextEmail, password });
      setUser(result.user || null);
      setEmail(nextEmail);
      return result.user || null;
    }

    async function signUp(nextEmail, password) {
      if (!configured) throw new Error("Auth not configured.");
      if (!nextEmail || !password) throw new Error("Email and password are required.");

      const pool = getPool();
      const attrs = [new CognitoUserAttribute({ Name: "email", Value: nextEmail })];
      await new Promise((resolve, reject) => {
        pool.signUp(nextEmail, password, attrs, null, (err, result) => {
          if (err) return reject(err);
          resolve(result);
        });
      });
      setEmail(nextEmail);
    }

    async function confirmEmail(code) {
      if (!configured) throw new Error("Auth not configured.");
      if (!email) throw new Error("Email is required.");
      if (!code) throw new Error("Confirmation code is required.");

      const pool = getPool();
      const user = new CognitoUser({ Username: email, Pool: pool });
      await new Promise((resolve, reject) => {
        user.confirmRegistration(code, true, (err, result) => {
          if (err) return reject(err);
          resolve(result);
        });
      });
    }

    async function resendConfirmation() {
      if (!configured) throw new Error("Auth not configured.");
      if (!email) throw new Error("Email is required.");
      const pool = getPool();
      const user = new CognitoUser({ Username: email, Pool: pool });
      await new Promise((resolve, reject) => {
        user.resendConfirmationCode((err, result) => {
          if (err) return reject(err);
          resolve(result);
        });
      });
    }

    async function signOut() {
      try {
        await api.logout();
      } finally {
        setUser(null);
      }
    }

    return {
      configured,
      authChecked,
      user,
      email,
      isAuthenticated: Boolean(user),
      signIn,
      signUp,
      confirmEmail,
      resendConfirmation,
      signOut,
    };
  }, [authChecked, configured, email, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
