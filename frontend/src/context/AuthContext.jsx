import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
} from "amazon-cognito-identity-js";

const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID || "";
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || "";

const TOKEN_STORAGE_KEY = "superdoc_id_token";
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

function readToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function writeToken(token) {
  try {
    if (!token) localStorage.removeItem(TOKEN_STORAGE_KEY);
    else localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore
  }
}

function writeEmail(email) {
  try {
    if (!email) localStorage.removeItem(EMAIL_STORAGE_KEY);
    else localStorage.setItem(EMAIL_STORAGE_KEY, email);
  } catch {
    // ignore
  }
}

function readEmail() {
  try {
    return localStorage.getItem(EMAIL_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function AuthProvider({ children }) {
  const [idToken, setIdToken] = useState(() => readToken());
  const [email, setEmail] = useState(() => readEmail());
  const configured = isConfigured();

  useEffect(() => {
    writeToken(idToken);
  }, [idToken]);

  useEffect(() => {
    writeEmail(email);
  }, [email]);

  const value = useMemo(() => {
    async function signIn(nextEmail, password) {
      if (!configured) throw new Error("Auth not configured.");
      if (!nextEmail || !password) throw new Error("Email and password are required.");

      const pool = getPool();
      const user = new CognitoUser({ Username: nextEmail, Pool: pool });
      const authDetails = new AuthenticationDetails({
        Username: nextEmail,
        Password: password,
      });

      const session = await new Promise((resolve, reject) => {
        user.authenticateUser(authDetails, {
          onSuccess: resolve,
          onFailure: reject,
          newPasswordRequired: () => reject(new Error("New password required.")),
          mfaRequired: () => reject(new Error("MFA required.")),
          totpRequired: () => reject(new Error("TOTP required.")),
        });
      });

      const token = session.getIdToken().getJwtToken();
      setIdToken(token);
      setEmail(nextEmail);
      return token;
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

    function signOut() {
      setIdToken("");
    }

    return {
      configured,
      idToken,
      email,
      isAuthenticated: Boolean(idToken),
      signIn,
      signUp,
      confirmEmail,
      resendConfirmation,
      signOut,
    };
  }, [configured, email, idToken]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

