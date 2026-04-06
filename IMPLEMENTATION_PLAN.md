# Implementation Plan

## Goal

Build a personal "LLM wiki" system where:

- Obsidian is the human-facing UI.
- Raw sources are stored immutably.
- Claude maintains a generated wiki of Markdown files.
- A VPS runs the automation so the system is reachable and useful even when the laptop is offline.

This plan reflects the current direction discussed on April 6, 2026:

- local Obsidian on the laptop
- VPS-hosted worker and API
- Obsidian Sync / Obsidian Headless as the easiest vault replication path
- Claude Code used as the wiki maintainer

## Recommendation

Do not start with a fully custom local API.

Start with this deployment model:

```text
Laptop
  Obsidian desktop
  Main user workflow

Obsidian Sync
  Shared remote vault

VPS
  Obsidian Headless sync client
  Local synced vault copy
  Small authenticated API
  Single-worker Claude job runner
```

This keeps the user experience simple:

- the laptop remains the editing and browsing surface
- the VPS does all automation
- long-running ingest/query/lint jobs do not depend on the laptop being awake
- mobile or remote triggers become easy later

## Core Product Shape

The system has three layers:

1. `raw/`
   Immutable source material. Articles, clipped pages, PDFs, notes, attachments, transcripts.
2. `wiki/`
   LLM-maintained knowledge base. Entity pages, topic pages, source summaries, comparisons, synthesized answers.
3. `CLAUDE.md`
   Operating manual for the agent. Defines structure, workflows, page formats, and update rules.

Suggested vault layout:

```text
vault/
  raw/
    inbox/
    sources/
    assets/
  wiki/
    entities/
    concepts/
    sources/
    queries/
    syntheses/
  index.md
  log.md
  CLAUDE.md
```

## Why VPS-First Automation

Running the API locally would work for experiments, but it is operationally weak:

- no always-on worker
- awkward auth and exposure
- fragile background processing
- laptop sleep breaks jobs
- hard to trigger from phone or other devices

The VPS architecture is cleaner because Claude runs where the automation lives.

## Sync Strategy

Preferred approach:

- use Obsidian Sync for the human workflow
- use Obsidian Headless on the VPS to maintain a synced local copy of the vault

Why this is the best first option:

- no custom file replication system
- same vault can be opened locally in Obsidian and processed remotely
- avoids building sync before building the actual product

Important constraint:

- only one automation job should write to the vault at a time

Recommended write discipline:

- human primarily adds material to `raw/`
- VPS worker writes `wiki/`, `index.md`, and `log.md`
- worker enforces a per-vault lock

Git is optional. It is useful for history and backups, but it should not be the primary sync mechanism if Obsidian Sync is already used. Mixing too many writers and sync layers increases conflict risk.

## API Design

The API should be narrow and job-based. Do not expose a generic "send prompt to Claude" endpoint.

Use bounded operations:

- `POST /ingest`
- `POST /query`
- `POST /lint`
- `GET /jobs/:id`
- `GET /health`

Optional later:

- `POST /reindex`
- `POST /rebuild-page`
- `POST /batch-ingest`

### Ingest

Input:

- source file path or note path
- optional focus or instructions

Behavior:

- validate source exists under `raw/`
- acquire lock
- run Claude against the vault
- update relevant wiki pages
- update `index.md`
- append to `log.md`
- release lock

### Query

Input:

- question
- optional mode: `answer-only` or `file-back-into-wiki`

Behavior:

- Claude reads `index.md` first
- reads relevant wiki pages
- writes answer
- optionally stores result under `wiki/queries/`
- appends to `log.md`

### Lint

Behavior:

- scan for stale claims
- scan for contradictions
- find orphan pages
- find missing page candidates
- suggest follow-up sources or questions
- write a report page and append to `log.md`

## Claude Execution Model

Initial implementation can shell out to `claude -p` from the worker.

Example shape:

```bash
claude -p \
  --cwd /srv/llm-wiki/vault \
  --output-format json \
  --max-turns 12 \
  --append-system-prompt "Follow CLAUDE.md. raw/ is immutable. Update wiki/, index.md, and log.md." \
  "Ingest raw/inbox/2026-04-06-example.md and update the wiki."
```

Rules:

- all prompts are generated server-side
- user input is only inserted into constrained fields
- no arbitrary shell or path input is passed through
- vault path is fixed in server config
- max turns, timeout, and concurrency are capped

Planned upgrade:

- move from subprocess execution to the Claude Code SDK once the workflow is stable

Reason:

- cleaner structured output
- better session handling
- easier observability
- easier retries and cancellation

## `CLAUDE.md` Responsibilities

`CLAUDE.md` is the most important control point in the system.

It should define:

- the vault structure
- which folders Claude may modify
- required frontmatter fields
- page naming rules
- `index.md` update format
- `log.md` entry format
- source citation style
- how contradictions are recorded
- how queries become persistent pages
- what "lint" checks mean

Key behavioral rules:

- never modify `raw/`
- always preserve citations back to source pages or files
- prefer updating existing pages before creating duplicate pages
- maintain bidirectional links where useful
- keep summaries concise and additive
- record uncertainty explicitly

## Obsidian Integration

Phase 1 can work without a custom plugin. Obsidian is just the vault browser/editor.

Manual MVP workflow:

1. clip or add a source into `raw/inbox/`
2. trigger `/ingest` from a small web UI, curl, or script
3. let the VPS worker update the wiki
4. watch the results appear in Obsidian via Sync

Useful later:

- a minimal Obsidian plugin with commands:
  - "Ingest current note"
  - "Ask wiki"
  - "Run lint"
  - "Show last job status"

The plugin should stay thin. Business logic belongs on the VPS, not in the Obsidian plugin.

## Security Model

The API should be auth-only and private by default.

Minimum requirements:

- HTTPS
- bearer token or signed API key auth
- rate limiting
- structured request logging
- no arbitrary prompt passthrough
- no arbitrary file paths
- no shell exposed to callers

Recommended deployment posture:

- private VPS
- reverse proxy in front of the API
- only a few fixed endpoints
- vault path configured via environment variables
- Claude credentials stored only on the VPS

## Suggested Tech Stack

Backend:

- TypeScript + Fastify or Express
- simple job queue in SQLite to start
- one worker process
- JSON logs

Why not overbuild:

- PostgreSQL is not needed for the MVP
- Redis is not needed if there is only one worker
- embeddings and vector search are not needed on day one

Search:

- start with `index.md` plus filesystem search
- later add `qmd` or another markdown search layer if the wiki gets large

## Phase Plan

### Phase 0: Vault Spec

Deliverables:

- folder layout
- page conventions
- `index.md` format
- `log.md` format
- first version of `CLAUDE.md`

Success criteria:

- a fresh vault is ready for human use and Claude maintenance

### Phase 1: Manual Remote Worker

Deliverables:

- VPS setup
- synced vault on VPS via Obsidian Headless
- shell script to run ingest/query/lint jobs manually

Success criteria:

- one source can be ingested end-to-end and reflected back into Obsidian

### Phase 2: Authenticated API

Deliverables:

- API with `ingest`, `query`, `lint`, `jobs`
- SQLite-backed job table
- per-vault lock
- timeout and retry handling

Success criteria:

- jobs can be triggered remotely and tracked reliably

### Phase 3: Obsidian UX Improvements

Deliverables:

- minimal plugin or command launcher
- "ingest current note" shortcut
- "ask wiki" action

Success criteria:

- user can operate the system from inside Obsidian without touching the server directly

### Phase 4: Search and Quality Features

Deliverables:

- better wiki search
- lint report pages
- conflict / contradiction registry
- source freshness checks

Success criteria:

- the wiki remains usable as volume grows

## Risks

### Sync Conflicts

If both the user and the worker edit the same generated pages often, conflicts will happen. The easiest mitigation is clear ownership: human edits raw inputs, worker edits generated outputs.

### Prompt Drift

If `CLAUDE.md` is vague, page quality will degrade over time. The workflow rules need to be explicit and testable.

### Overly Broad API

A generic "chat with the vault" endpoint will make the system hard to reason about and harder to secure. Keep actions explicit.

### Unbounded Cost

Batch ingestion or broad lint passes can get expensive. Put limits on source size, turns, frequency, and concurrency.

## MVP Definition

The MVP is complete when:

- a source added to `raw/inbox/` can be ingested remotely
- Claude updates `wiki/`, `index.md`, and `log.md`
- the changes sync back into local Obsidian
- a query can optionally become a persistent wiki page
- only one worker job writes at a time

## Immediate Next Steps

1. Write the initial vault spec and `CLAUDE.md`.
2. Create the vault skeleton.
3. Stand up a VPS with Obsidian Headless syncing the vault.
4. Implement a single-worker API with `POST /ingest`, `POST /query`, `POST /lint`.
5. Test one real ingest flow end to end before building any plugin.

## Source Links

These are the official docs that most directly support this plan:

- [Claude Code setup](https://code.claude.com/docs/en/setup)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Code SDK](https://docs.anthropic.com/en/docs/claude-code/sdk)
- [Claude Code memory / `CLAUDE.md`](https://docs.anthropic.com/en/docs/claude-code/memory)
- [Obsidian Headless](https://help.obsidian.md/headless)
- [Obsidian Headless Sync](https://help.obsidian.md/sync/headless)
- [Obsidian Sync](https://help.obsidian.md/sync)
- [Obsidian Web Clipper](https://obsidian.md/help/web-clipper)
- [Obsidian URI](https://obsidian.md/help/uri)
- [Obsidian CLI](https://help.obsidian.md/cli)

