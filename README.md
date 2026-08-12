# Paper Viewer

A research team's shared paper workspace: daily arXiv recommendations with AI intros, a top-conference catalog, collaborative PDF annotation, and per-paper AI chat — built for small reading groups.

## Features

- **Today** — a daily arXiv digest per workspace (topic/keyword preferences, weekday cron), each paper with an LLM-generated structured intro; optional Feishu (Lark) push. Digest papers stay out of the library until someone explicitly saves them.
- **Conferences** — accepted-paper lists for recent systems/database venues (SOSP, OSDI, ATC, NSDI, EuroSys, ASPLOS, SIGMOD, VLDB), synced from [csconf-papers](https://github.com/RealZST/csconf-papers). Venue/year chips, cross-catalog search, source links, and inline PDF preview where a direct PDF exists.
- **Save to library** — the single gate that turns any discovered paper into a team library entry, with cross-source duplicate detection (DOI / arXiv id / normalized title) and automatic AI intro generation on save.
- **Paper workspace** — pinned PDF snapshots (annotation anchors never drift), text and area annotations with per-annotation discussion threads and labels, a bookmark-derived table of contents, paper-level comments with admin moderation, per-user reading states, and an AI chat grounded in the paper's full text.
- **Team features** — invitation-based membership with owner/admin/member roles, shared label vocabulary, zh/en interface.

## Stack

Next.js 15 (App Router) · React 19 · Prisma 6 + PostgreSQL · S3-compatible object storage (MinIO locally, optional Vercel Blob for PDF snapshots) · next-intl · react-pdf-highlighter · pnpm workspaces (`apps/web`, `packages/core|db|storage`) · vitest + Playwright.

## Local development

Prerequisites: Node 22+, pnpm 10 (via corepack), Docker (or a local PostgreSQL 16 + MinIO).

```bash
# 1. Services (PostgreSQL + MinIO)
docker compose up -d
docker compose run --rm minio-client   # creates the paper-pdfs bucket

# 2. Configure
cp .env.example .env                   # fill in secrets; see the table below

# 3. Install & migrate
pnpm install
pnpm db:generate
pnpm db:migrate

# 4. Run
pnpm dev                               # http://localhost:3000
# First run: visit /bootstrap to create the owner account.
```

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` / `DIRECT_URL` | ✅ | PostgreSQL (pooled / direct; identical locally) |
| `AUTH_SECRET` | ✅ | Session cookie signing (≥16 chars) |
| `INGEST_API_KEY` | ✅ | Auth for the external ingest endpoint (≥16 chars) |
| `APP_URL` | prod | Absolute base URL — Feishu card links break without it |
| `CRON_SECRET` | prod | Auth for `/api/cron/*`; the daily digest is off without it |
| `S3_*` | local | Object storage for uploaded/pinned PDFs (MinIO defaults in `.env.example`) |
| `BLOB_READ_WRITE_TOKEN` | optional | Vercel Blob for PDF snapshots in production |
| `RESEND_API_KEY` | optional | Invitation e-mails |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | optional | Fallback LLM config; prefer per-workspace setup in Settings → LLM |
| `CONFERENCE_SOURCE_URL` | optional | Overrides the conference catalog repo |

### Testing

```bash
pnpm lint                      # tsc across all packages
pnpm test                      # unit tests (vitest)
pnpm test:e2e                  # Playwright; needs the dev stack running and .env exported
```

## Deployment

Designed for **Vercel + Neon** free tiers: `vercel.json` at the repo root carries the build command, output directory, and the weekday digest crons. Provision a Neon project, run `prisma migrate deploy` against it, set the environment variables above in Vercel, deploy, then visit `/bootstrap`. Per-workspace LLM keys, research preferences, and the Feishu webhook are configured in-app under Settings.

## License

[AGPL-3.0](LICENSE)
