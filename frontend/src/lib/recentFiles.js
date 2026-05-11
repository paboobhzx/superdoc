const RECENT_FILES_KEY = "superdoc_recent_files"
const MAX_RECENT = 20

export function loadRecentFiles() {
  try {
    return JSON.parse(sessionStorage.getItem(RECENT_FILES_KEY) || "[]")
  } catch {
    return []
  }
}

export function saveRecentFile(entry) {
  if (!entry?.jobId || !entry?.downloadUrl) return
  try {
    const existing = loadRecentFiles()
    const updated = [entry, ...existing.filter((item) => item.jobId !== entry.jobId)].slice(0, MAX_RECENT)
    sessionStorage.setItem(RECENT_FILES_KEY, JSON.stringify(updated))
  } catch {
    // sessionStorage unavailable
  }
}

export function removeRecentFile(jobId) {
  try {
    const updated = loadRecentFiles().filter((item) => item.jobId !== jobId)
    sessionStorage.setItem(RECENT_FILES_KEY, JSON.stringify(updated))
  } catch {
    // sessionStorage unavailable
  }
}
