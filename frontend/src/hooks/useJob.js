import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api";
import { getSessionId } from "../lib/session";

const TERMINAL = new Set(["DONE", "FAILED"]);
const POLL_MS  = 2000;

/**
 * Polls GET /jobs/{jobId} every 2 seconds until status is DONE or FAILED.
 * Returns { job, loading, error, cancel }.
 */
export function useJob(jobId) {
  const [job,     setJob]     = useState(null);
  const [loading, setLoading] = useState(!!jobId);
  const [err,     setErr]     = useState(null);
  const timerRef = useRef(null);

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (!jobId) return;

    let active = true;

    async function poll() {
      try {
        const data = await api.getStatus(jobId, getSessionId());
        if (!active) return;
        setJob(data);
        setLoading(false);
        if (!TERMINAL.has(data.status)) {
          timerRef.current = setTimeout(poll, POLL_MS);
        }
      } catch (e) {
        if (!active) return;
        setErr(e.message);
        setLoading(false);
      }
    }

    poll();
    return () => {
      active = false;
      cancel();
    };
  }, [jobId, cancel]);

  return { job, loading, error: err, cancel };
}
