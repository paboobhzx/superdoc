const SESSION_KEY = "superdoc_session"

export function getSessionId() {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const created = crypto.randomUUID()
    try {
      sessionStorage.setItem(SESSION_KEY, created)
    } catch {
      // setItem may fail (QuotaExceeded, private mode on some engines).
      // Still return the UUID for this session even if it can't be persisted.
    }
    return created
  } catch {
    return ""
  }
}

export function clearSessionId() {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Storage can be unavailable in privacy modes.
  }
}
