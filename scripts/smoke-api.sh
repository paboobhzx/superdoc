#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-}"

if [[ -z "$API_URL" ]]; then
  echo "API_URL is required (example: https://abc.execute-api.us-east-1.amazonaws.com/dev)" >&2
  exit 2
fi

echo "[smoke] GET /health"
curl -sS "${API_URL}/health" | grep -q '"status":"ok"'

echo "[smoke] OPTIONS /jobs (CORS preflight)"
curl -sS -D - -o /dev/null -X OPTIONS "${API_URL}/jobs" \
  -H 'Origin: https://example.com' \
  -H 'Access-Control-Request-Method: POST' \
  | tr -d '\r' | grep -qi '^Access-Control-Allow-Origin: \*'

echo "[smoke] OPTIONS /operations (CORS preflight)"
curl -sS -D - -o /dev/null -X OPTIONS "${API_URL}/operations" \
  -H 'Origin: https://example.com' \
  -H 'Access-Control-Request-Method: GET' \
  | tr -d '\r' | grep -qi '^Access-Control-Allow-Origin: \*'

echo "[smoke] OPTIONS /users/me/files/dummy (CORS preflight)"
curl -sS -D - -o /dev/null -X OPTIONS "${API_URL}/users/me/files/dummy" \
  -H 'Origin: https://example.com' \
  -H 'Access-Control-Request-Method: DELETE' \
  | tr -d '\r' | grep -qi '^Access-Control-Allow-Methods:.*DELETE'

echo "[smoke] GET /operations"
OPS_JSON="$(curl -sS "${API_URL}/operations")"
echo "$OPS_JSON" | grep -q '"operations"'
echo "$OPS_JSON" | grep -q '"pdf_to_docx"'
echo "$OPS_JSON" | grep -Eq '"kind"[[:space:]]*:[[:space:]]*"backend_job"'
echo "$OPS_JSON" | grep -Eq '"intent"[[:space:]]*:[[:space:]]*"convert"'

echo "[smoke] GET /operations?input_type=pdf"
PDF_OPS_JSON="$(curl -sS "${API_URL}/operations?input_type=pdf")"
echo "$PDF_OPS_JSON" | grep -q '"pdf_edit"'
echo "$PDF_OPS_JSON" | grep -q '"pdf_to_image"'

echo "[smoke] POST /jobs (create job with conversion params)"
JOB_JSON="$(curl -sS -X POST "${API_URL}/jobs" \
  -H 'Content-Type: application/json' \
  -d '{"operation":"pdf_to_image","file_size_bytes":1024,"file_name":"smoke.pdf","session_id":"smoke","params":{"dpi":150}}')"

echo "$JOB_JSON" | grep -q '"job_id"'
echo "$JOB_JSON" | grep -q '"upload"'

echo "[smoke] OK"
