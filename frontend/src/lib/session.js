const SESSION_KEY = "superdoc_session"

export function getSessionId() {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const created = crypto.randomUUID()
    sessionStorage.setItem(SESSION_KEY, created)
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
