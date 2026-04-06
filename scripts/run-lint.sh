#!/usr/bin/env bash
# Phase 1 manual lint wrapper.
# Usage: run-lint.sh [--all]
#
# Default scope: recent (last 7 days). --all sweeps the whole vault.

set -euo pipefail

VAULT="${LLMWIKI_VAULT:-/srv/llm-wiki/vault}"
LOCK="${LLMWIKI_LOCK:-/srv/llm-wiki/state/vault.lock}"
INVARIANTS="${LLMWIKI_INVARIANTS:-/srv/llm-wiki/etc/system-invariants.txt}"

SCOPE="recent"
if [[ "${1:-}" == "--all" ]]; then
  SCOPE="all"
fi

mkdir -p "$(dirname "$LOCK")"

PROMPT="Task: run a lint pass over the wiki.

Scope: ${SCOPE}

Procedure: follow the \"Lint\" workflow in CLAUDE.md exactly.
Note: in Phase 1, no pre-flight LintFinding[] report is provided — perform the checks yourself by reading index.md and the wiki/ pages.
Write the report to wiki/syntheses/lint-report-\$(date +%Y-%m-%d).md.
Update index.md and append one entry to log.md.
Do not delete or rewrite pages on your own initiative; only flag and recommend."

cd "$VAULT"
exec flock -n "$LOCK" claude -p \
  --output-format json \
  --append-system-prompt-file "$INVARIANTS" \
  --permission-mode acceptEdits \
  --disallowedTools WebSearch --disallowedTools WebFetch \
  --no-session-persistence \
  --fallback-model sonnet \
  "$PROMPT"
