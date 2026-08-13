<h1 align="center">Paper Viewer</h1>

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <strong>A self-hosted paper workspace for research reading groups.</strong><br/>
  A daily arXiv digest with AI intros, a top-conference catalog, a shared library, PDF annotation, and per-paper AI chat.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/Next.js-15-black?style=flat-square" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/PostgreSQL-Prisma%206-336791?style=flat-square" alt="PostgreSQL + Prisma" />
  <img src="https://img.shields.io/badge/deploy-Vercel%20%2B%20Neon-000?style=flat-square" alt="Vercel + Neon" />
</p>

<p align="center">
  <a href="#what-it-is-for">What it is for</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="#key-features">Features</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="DEPLOYMENT.md">Deploy</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="#local-development">Local Development</a>
</p>

---

## What it is for

A reading group usually runs one workflow across three separate tools: an arXiv feed or mailing list to find papers, a group chat to share them, and each person's own PDF reader to annotate them. Nothing carries between the three — chat messages scroll out of view, and annotations stay on one machine.

Paper Viewer covers all three in one application. It selects papers on a schedule, writes a structured intro for each, sends the day's list to the group chat, and keeps the papers the group decides to keep — together with their PDFs, highlights, discussion threads, and an AI chat that has the full text.

It is self-hosted, runs on Vercel and Neon free tiers, and stores everything in a database you control.

---

## Key Features

### 📬 Daily arXiv Digest

Each workspace configures its own research topics and keywords. On every weekday, the digest job searches arXiv, ranks the new papers against those interests, and produces the day's list.

- **Structured AI intros** — each paper gets motivation, problem, method, key findings, and why it matters, as separate fields rather than a restated abstract. Written in Chinese or English, whichever the workspace picks.
- **Daily overview** — one short summary covering the whole batch, shown above the list.
- **Feishu (Lark) push** — with a webhook and a push hour configured, the digest card is sent to the group chat at that hour, at most once per day.
- **Digest papers are not library papers** — they open as a read-only preview until someone saves one explicitly, so the daily list does not change the shared library on its own.
- **Any OpenAI-compatible model** — Kimi/Moonshot, DeepSeek, OpenAI, or a self-hosted gateway, configured per workspace in Settings.

### 🏛️ Top-Conference Catalog

Accepted-paper lists for major systems and database venues — currently **SOSP, OSDI, ATC, NSDI, EuroSys, ASPLOS, SIGMOD and VLDB** — synced from [csconf-papers](https://github.com/RealZST/csconf-papers).

- **Browse or search** — filter by venue and year, or search across every catalog at once.
- **Inline full text where available** — about two thirds of the catalog opens in the app; the rest link out to the publisher. Papers served from an arXiv preprint are labelled, so it is clear when the text is not the version of record.
- **Save to library** — catalog papers enter the library through the same duplicate checks as every other source.

### 📚 Shared Library

- **One entry point for every source** — the daily digest, the conference catalog, an uploaded PDF, or a pasted arXiv/DOI URL.
- **Cross-source duplicate detection** — DOI, arXiv id, and normalized title, so the same paper reached three ways stays one entry.
- **Filters and search** — by time window, label, or reading state; full-text search over titles and authors; topic chips for the most-used topics.
- **Shared labels** — a colour-coded vocabulary defined once in Settings and applied to both papers and highlights.

### 🖍️ PDF Annotation

- **Pinned PDF snapshots** — the file is stored on first open, so highlight anchors stay valid when arXiv publishes a new version.
- **Text and area highlights** — select a passage, or drag a box over a figure; both are stored as anchored annotations.
- **A discussion thread per highlight** — replies attach to the specific highlight rather than to the paper as a whole.
- **Table of contents** — the PDF's own bookmarks are rendered as a clickable outline.
- **Per-user reading states** — new / reading / discussed, tracked separately for each member.
- **Keyboard navigation** — `j`/`k` move through the library order, `1`–`4` switch the sidebar panels.

### 💬 Discussion and AI Chat

- **Paper-level comments with replies** — a reply is indented one level under the comment it answers and carries an `@name` label.
- **Role-based moderation** — authors manage their own comments; owners and admins can edit or delete anyone's.
- **Chat over the full text** — questions are answered from the paper's extracted text, not from the abstract.
- **Markdown rendering** — headings, lists, tables and code blocks render in comments, chat and intros, with one-click copy of the raw source.

### 👥 Team, Roles and Languages

- **Invitation-based membership** — invite by e-mail or by copying a link. Owner, admin and member roles.
- **Admin-only actions** — LLM keys, research preferences, the Feishu webhook, catalog syncs, member invitations, and removing a paper from the shared library.
- **Bilingual** — the interface is Simplified Chinese or English per reader; the language AI writes intros and the daily overview in is a separate workspace-wide setting.

---

## Deployment

Paper Viewer runs on free tiers: Vercel Hobby for the app and cron, Neon for Postgres, Vercel Blob for stored PDFs. Setup takes about 15 minutes.

**→ [Deployment guide](DEPLOYMENT.md)** — Neon and Vercel setup, environment variables, the `/bootstrap` owner account, in-app configuration, punctual digest scheduling, self-hosting without Vercel, and troubleshooting.

---

## Local Development

**Prerequisites:** Node 22+, pnpm 10 (via corepack), Docker (or your own PostgreSQL 16 + MinIO).

```bash
# 1. Services: PostgreSQL + MinIO
docker compose up -d
docker compose run --rm minio-client     # creates the paper-pdfs bucket

# 2. Configure
cp .env.example .env                     # local defaults are filled in already

# 3. Install and migrate
pnpm install
pnpm db:generate
pnpm db:migrate

# 4. Run
pnpm dev                                 # http://localhost:3000
```

Then visit `/bootstrap` to create the owner account.

> Set `NEXT_PUBLIC_AUTO_GENERATE_INTRO=off` locally so that opening a fixture paper does not trigger real LLM calls.

### Tests

```bash
pnpm lint          # tsc across every package
pnpm test          # unit tests (vitest)
pnpm test:e2e      # Playwright; needs the dev stack running and .env exported
```

### Project layout

```
apps/web            Next.js 15 App Router app — pages, API routes, components
packages/core       Pure domain logic (permissions, labels, LLM config, upload validation)
packages/db         Prisma schema, client, migrations
packages/storage    S3 / object-storage helpers
```

**Stack:** Next.js 15 (App Router) · React 19 · Prisma 6 + PostgreSQL · Vercel Blob / S3 · next-intl · react-pdf-highlighter · pnpm workspaces · vitest + Playwright.

---

## License

[AGPL-3.0](LICENSE). If you run a modified version as a network service, the modified source must be made available to its users.
