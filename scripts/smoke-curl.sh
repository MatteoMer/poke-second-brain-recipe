#!/usr/bin/env bash
# Quick smoke-test curls against a running llm-wiki-api on localhost.
# Run via SSH tunnel:  ssh -L 8080:localhost:8080 vps

set -euo pipefail

API="${API:-http://127.0.0.1:8080}"
TOKEN="${API_TOKEN:?set API_TOKEN env var first}"
H_AUTH="Authorization: Bearer $TOKEN"
H_JSON="Content-Type: application/json"

say() { printf '\n\033[1;34m> %s\033[0m\n' "$*"; }

say "GET /health"
curl -sSf "$API/health" | head

say "POST /ingest"
JOB=$(curl -sSf -X POST -H "$H_AUTH" -H "$H_JSON" \
  -d '{"sourceRelPath":"raw/inbox/example.md"}' \
  "$API/ingest" | tee /dev/stderr | sed -n 's/.*"jobId":"\([^"]*\)".*/\1/p')

say "poll GET /jobs/$JOB"
for _ in $(seq 1 30); do
  out=$(curl -sSf -H "$H_AUTH" "$API/jobs/$JOB")
  status=$(printf '%s' "$out" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
  echo "  status=$status"
  case "$status" in
    succeeded|failed|cancelled) printf '\nfinal:\n%s\n' "$out"; exit 0 ;;
  esac
  sleep 2
done
echo "timed out waiting for job" >&2
exit 1
