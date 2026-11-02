# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Entity Workspace: a Vietnamese-language web app for managing brand/entity profiles across many third-party platforms, for multiple projects (websites/brands) in one workspace. Express 5 API + React 19/Vite SPA, persisted in SQLite via Node's built-in `node:sqlite` (no external DB). User-facing strings, error messages, README and docs are in Vietnamese — keep new UI/error text in Vietnamese.

## Commands

Requires Node.js 24+ and pnpm 11.25.0 (pinned via `packageManager`; use `corepack enable`). Only pnpm is allowed — `preinstall` rejects other package managers; never create another lockfile.

```bash
pnpm install --frozen-lockfile
pnpm run dev          # API on :4310 (node --watch) + Vite on :5173 (proxies /api)
pnpm run build        # tsc -b (type-check) + vite build -> dist/
pnpm start            # production server: serves API + dist/ on 127.0.0.1:4310
pnpm test             # node --test over tests/*.test.js
pnpm run test:e2e     # Chromium via playwright-core (tests/e2e/)
pnpm run check        # build + test (what CI runs, plus test:e2e)
pnpm run smoke        # against a running server; no external calls
pnpm run format       # prettier
```

Run a single test file / test by name:

```bash
node --test --test-isolation=none tests/queue.test.js
node --test --test-isolation=none --test-name-pattern="lease" tests/*.test.js
```

E2E uses `CHROMIUM_PATH`, else `/usr/bin/chromium`, else a Playwright-installed browser (`pnpm exec playwright-core install chromium`). Screenshots go to `test-results/`. On Windows, point it at installed Chrome: `CHROMIUM_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"`.

`pnpm start`/`dev` load `.env` if present (see `.env.example`). Binding to a non-loopback host requires `ENTITY_ACCESS_TOKEN` (≥24 chars). Data lives in `ENTITY_DATA_DIR` (default `data/`): `entity.sqlite` and `.vault-key`.

## Architecture

Server is plain ESM JavaScript (`server/`); frontend is TypeScript (`src/`). `server/index.js` wires the pieces with constructor injection, which tests reuse directly:

- `Store` (`store.js`) — all SQLite schema and queries; `new Store()` defaults to `:memory:` for tests. Owns projects, platforms (seeded from `catalog.js`), profiles, accounts, batches, jobs, history. `ACTIVE` job states = queued/running/retry/action_required.
- `createVault` (`vault.js`) — AES-256-GCM encryption of API tokens, bound to the account ID. Key from `ENTITY_VAULT_KEY` or generated `data/.vault-key`.
- `createNetwork` (`network.js`) — the only outbound HTTP path: preserves env proxy/CA, rejects private/IP/odd-port destinations (incl. DNS to private nets), timeouts, response size limits, no redirects when a token is attached, retry delay/429 handling. Accepts `lookup`/`fetchImpl` for test injection.
- `Connectors` (`connectors.js`) — platform adapter boundary. Contract: `identity(platform, token)` (read-only), `sync(project, platform, account, token)` (confirm `remote_id`, read-before-write, idempotent, returns `changed`), `verify(project, platform, profileUrl)` (public read, no token; distinguishes `healthy`/`unknown`/`needs_review`/`unavailable`), `payloadFor` (GitHub 160-char / GitLab 255-char description limits). `analyzeHtml` does heuristic brand-name/backlink/noindex checks. Only GitHub and GitLab have API adapters; GitLab's API lets only admins edit profiles, so GitLab `sync` is read-only and hands mismatches to the operator.
- `Worker` (`worker.js`) — SQLite-backed job queue for `prepare`/`verify`/`sync` jobs. Claims only when batch open, platform enabled, not paused, rate limit allows, and no other running job for the same project–platform; max 2 running globally. 90s lease renewed every 20s; expired leases are recovered. 429/5xx/network errors retry up to 3× with per-origin cooldown; auth/shape errors hand off to a human (`action_required`). Monitoring re-checks at 1/7/30 days after first verification, then every 30 days (`nextCheck`).
- `createApp` (`app.js`) — Express routes under `/api`, zod validation, bearer-token auth (timing-safe), origin checks (requires `X-Entity-Client` header from the SPA), CSV export, serves `dist/`.
- `mail.js` — `createMail({ network, ImapClass, lookup })`: mailbox providers `imap` (imapflow, TLS 993, public-host check), `gmail_api` (service-account JWT, domain-wide delegation, gmail.readonly, via `network.js`) and `manual`; `platformMessages` (ties mail to a platform by sender domain or links) and `verificationLinks` (links on the platform's own host only). Mailboxes are workspace-level, secrets vault-encrypted with the mailbox id; projects reference one via `mailbox_id`.
- `schema.js` — `entitySchema` builds Organization/Person JSON-LD whose `sameAs` lists only `healthy` profiles (`GET /api/projects/:id/schema`).
- `urls.js` — URL normalization, `publicUrl` validation, hostname keys (strip `www`), `AppError`, CSV escaping. `catalog.js` — seed platforms and TXT/CSV import parsing/classification.

Frontend: `src/App.tsx` is the main shell; dialogs in `src/modals/`, shared widgets in `src/components/`, API client in `src/api.ts` (stores access token in `sessionStorage`), shared types in `src/types.ts`.

## Invariants to preserve

- Business rule: each website (project) has its own required email, unique across projects by `emailKey` (case, `+tag` and Gmail dots ignored); all entity profiles of that website register with exactly that address (no plus-addressing). A personal Gmail mailbox can only serve the project whose email is that Gmail.

See `docs/CONNECTORS.md` (adapter contract, queue rules) and `docs/OPERATIONS.md` (backup/restore).

- Never disable TLS verification or bypass `network.js` safeguards when adding adapters.
- Sync must stay idempotent and read-before-write — lease recovery depends on it. Auto-creating accounts is intentionally unsupported until reconciliation/dedup exists.
- Login/CAPTCHA pages, HTTP 403, and network errors must never be reported as verified or deleted.
- Never fabricate project data (addresses, ownership, business info) in payloads; operator-declared metadata (ownership/email/2FA) is kept distinct from automated check results.
- No project-specific domain is a default; `examples/reference-urls.txt` is reference data only.
- Tests mock all external platforms (`tests/helpers.js`, in-memory `Store`, `interval_ms=0` to bypass rate limits); never hit real accounts in tests or claim an adapter is tested against a real API when only fixtures exist.
