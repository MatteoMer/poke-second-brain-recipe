# Next Steps

The local code (vault skeleton, server, plugin, scripts) is done and committed. Everything from here on requires the VPS or Obsidian Sync. Steps are listed in dependency order — don't skip ahead.

## 0. Two important gotchas before you SSH

1. **The repo's `vault/` is the *spec*, not the live vault.** The live vault is `/srv/llm-wiki/vault`, populated by `ob sync` against your Obsidian Sync remote — that's where your real notes live. The `vault/` inside the repo is just the template skeleton plus the canonical `CLAUDE.md`. Never point `ob sync-setup` at the repo's `vault/`, or you'll overwrite your real notes.

2. **The systemd unit's paths assume the repo lives at `/srv/llm-wiki/repo`.** If you clone somewhere else, edit `WorkingDirectory` and `ExecStart` in `scripts/llm-wiki-api.service` accordingly before installing it.

## 1. Bootstrap the VPS

```sh
ssh vps
git clone git@github.com:MatteoMer/poke-second-brain-recipe.git /tmp/llm-wiki
sudo bash /tmp/llm-wiki/scripts/bootstrap-vps.sh
```

This installs Node 22, `obsidian-headless`, creates the `llmwiki` user, makes `/srv/llm-wiki/{vault,bin,etc,state,log,server}`, writes `/etc/llm-wiki/env` with a fresh `API_TOKEN`, and writes the system invariants file.

It assumes `claude` is already on `PATH` and authenticated for the `llmwiki` user. If not, fix that before going further:

```sh
sudo -u llmwiki claude --version
sudo -u llmwiki claude auth login   # only if needed
```

## 2. Clone the working copy + build the server

Cloning to `/srv/llm-wiki/repo` matches what `scripts/llm-wiki-api.service` expects.

```sh
sudo -u llmwiki git clone git@github.com:MatteoMer/poke-second-brain-recipe.git /srv/llm-wiki/repo
cd /srv/llm-wiki/repo/server
sudo -u llmwiki npm ci
sudo -u llmwiki npm run build
sudo -u llmwiki npm test     # should print 34/34 passing
```

Your deploy loop becomes:

```sh
cd /srv/llm-wiki/repo
sudo -u llmwiki git pull
cd server && sudo -u llmwiki npm ci && sudo -u llmwiki npm run build
sudo systemctl restart llm-wiki-api
```

## 3. Wire Obsidian Sync to the VPS

```sh
sudo -u llmwiki ob login              # interactive: email, password, MFA, e2e password
sudo -u llmwiki ob sync-list-remote   # confirm vault names
sudo -u llmwiki ob sync-setup         # bind remote vault → /srv/llm-wiki/vault
```

Install and start the headless sync unit:

```sh
sudo install -o root -g root -m 0644 /srv/llm-wiki/repo/scripts/obsidian-headless.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now obsidian-headless.service
tail -f /srv/llm-wiki/log/obsidian.log
```

Verify both directions of sync work:
- Drop a file in `raw/inbox/` from the laptop → `cat /srv/llm-wiki/vault/raw/inbox/<file>` should show it within seconds.
- Touch a file in `/srv/llm-wiki/vault/wiki/` from the VPS → it should appear in Obsidian on the laptop.

If you want the repo's canonical `CLAUDE.md` to be the live one, copy it over once the live vault exists:

```sh
sudo -u llmwiki cp /srv/llm-wiki/repo/vault/CLAUDE.md /srv/llm-wiki/vault/CLAUDE.md
```

(The live vault syncs to your laptop, so this change will appear in Obsidian and propagate via Obsidian Sync.)

## 4. Phase 1 manual ingest end-to-end

The first real test of `CLAUDE.md`. Drop a real article into `raw/inbox/` from your laptop, wait for sync, then on the VPS:

```sh
sudo -u llmwiki /srv/llm-wiki/repo/scripts/run-ingest.sh raw/inbox/2026-04-07-test.md
```

Expected:
- New file under `wiki/sources/2026-04-07-<slug>.md`
- New or updated entries under `wiki/entities/` and `wiki/concepts/`
- `index.md` updated
- Exactly one new entry in `log.md` with the `## [<ISO>] ingest | <jobId> | …` prefix
- All of the above sync back to the laptop within seconds

If the agent does the wrong thing, **fix `CLAUDE.md`** rather than the prompt. Expect to revise it after the first 2–3 runs.

## 5. Deploy the API + worker

```sh
sudo install -o root -g root -m 0644 /srv/llm-wiki/repo/scripts/llm-wiki-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now llm-wiki-api.service
journalctl -u llm-wiki-api -f
```

Smoke test from the laptop via SSH tunnel:

```sh
ssh -L 8080:localhost:8080 vps   # leave running
# in another terminal:
API_TOKEN=$(ssh vps "sudo cat /etc/llm-wiki/env" | grep ^API_TOKEN | cut -d= -f2)
API=http://127.0.0.1:8080 API_TOKEN="$API_TOKEN" bash scripts/smoke-curl.sh
```

This should hit `/health`, then `POST /ingest`, then poll `/jobs/:id` until it succeeds.

## 6. (Optional) TLS for the Obsidian plugin

Phase 3 (Obsidian plugin) is the only reason TLS is required — Obsidian/Electron rejects plain HTTP and self-signed certs. Until you set this up, Phase 2 is fully usable over the SSH tunnel + curl.

When ready, install Caddy (recommended: auto-HTTPS via Let's Encrypt, single-file config) and add a reverse proxy to `127.0.0.1:8080`. Then in Obsidian:

- `cd plugin && npm run build`
- Copy `manifest.json` + `main.js` into `<vault>/.obsidian/plugins/llm-wiki/`
- Enable the plugin, set the API base URL (https://your-host) and the `API_TOKEN`
- Try the four commands: ingest current note, ask wiki, run lint, show last job status

## 7. (Optional) Daily lint cron

Once you've run a few real lints and decided they're useful, enable the daily sweep:

```sh
sudo -u llmwiki crontab -e
# add:
0 3 * * * /srv/llm-wiki/repo/scripts/cron-lint.sh >> /srv/llm-wiki/log/cron-lint.log 2>&1
```

## Small follow-ups, not blocking

- Add `.vite/` to `.gitignore` (vitest scratch dir created during test runs).
- After ~5 real ingests, revise `vault/CLAUDE.md` based on what the agent gets wrong.
- Decide whether the in-vault `data.json` storing the plugin's `API_TOKEN` is acceptable for your trust model (the token will sync across all devices that use the same Obsidian Sync vault).
