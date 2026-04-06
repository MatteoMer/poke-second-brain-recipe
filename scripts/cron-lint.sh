#!/usr/bin/env bash
# Phase 4 daily lint trigger. Hits the API on localhost.
# Install via:  crontab -u llmwiki -e
#   0 3 * * * /srv/llm-wiki/bin/cron-lint.sh >> /srv/llm-wiki/log/cron-lint.log 2>&1

set -euo pipefail

# Source the env file to pick up API_TOKEN, PORT, HOST.
# shellcheck disable=SC1091
source /etc/llm-wiki/env

curl -sSf \
  -X POST \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"scope":"recent"}' \
  "http://${HOST:-127.0.0.1}:${PORT:-8080}/lint"
echo
