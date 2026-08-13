<h1 align="center">Deployment Guide</h1>

<p align="center">
  <strong>English</strong> · <a href="DEPLOYMENT.zh-CN.md">简体中文</a> &nbsp;&nbsp;|&nbsp;&nbsp; <a href="README.md">← Back to README</a>
</p>

---

Paper Viewer is designed to run on free tiers: **Vercel Hobby** for the app and cron, **Neon** for Postgres, **Vercel Blob** for stored PDFs. Budget about 15 minutes end to end.

**Contents**

1. [Prerequisites](#prerequisites)
2. [Fork the repository](#1-fork-the-repository)
3. [Create the database on Neon](#2-create-the-database-on-neon)
4. [Import the project into Vercel](#3-import-the-project-into-vercel)
5. [Environment variables](#4-environment-variables)
6. [Create a Blob store for PDFs](#5-create-a-blob-store-for-pdfs)
7. [Deploy and create the owner account](#6-deploy-then-create-the-owner-account)
8. [Configure the workspace in-app](#7-configure-the-workspace-in-app)
9. [Make the daily push punctual](#8-make-the-daily-push-punctual-optional)
10. [Custom domain and updates](#9-custom-domain-and-updates)
11. [Self-hosting without Vercel](#self-hosting-without-vercel)
12. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| What | Why |
|---|---|
| A GitHub account | Vercel deploys from your fork |
| A [Vercel](https://vercel.com) account | Hosting + cron |
| A [Neon](https://neon.tech) account | Serverless Postgres |
| An LLM API key | Any OpenAI-compatible endpoint (Kimi/Moonshot, DeepSeek, OpenAI…) |
| A Feishu (Lark) group webhook | Optional — only if you want the daily push |

---

## 1. Fork the repository

Fork this repo to your own GitHub account. Deploying from a fork is what lets you pull upstream updates later, and it is required for the optional GitHub Actions trigger in step 8.

## 2. Create the database on Neon

1. Create a Neon project. Pick a region close to the Vercel region you will use (`vercel.json` defaults to `sin1`, Singapore — change it if your team is elsewhere).
2. From the project dashboard, copy **two** connection strings:

   | Neon calls it | Set it as | Why |
   |---|---|---|
   | Pooled connection | `DATABASE_URL` | Serverless functions open many short-lived connections |
   | Direct connection | `DIRECT_URL` | Prisma migrations cannot run through the pooler |

## 3. Import the project into Vercel

1. **Add New → Project**, import your fork.
2. Leave the build settings alone — `vercel.json` at the repo root already sets the install command, build command, output directory, region and cron schedules.
3. Add the environment variables below, then deploy.

## 4. Environment variables

Set these in **Vercel → Settings → Environment Variables** (Production, and Preview if you use it):

| Variable | Required | What it is |
|---|:---:|---|
| `DATABASE_URL` | ✅ | Neon pooled connection string |
| `DIRECT_URL` | ✅ | Neon direct connection string (migrations) |
| `AUTH_SECRET` | ✅ | Session-cookie signing key, ≥16 chars — `openssl rand -base64 32` |
| `INGEST_API_KEY` | ✅ | Auth for the external ingest endpoint, ≥16 chars |
| `APP_URL` | ✅ | Absolute base URL, e.g. `https://your-app.vercel.app`. Feishu card links break without it |
| `CRON_SECRET` | ✅ | Auth for `/api/cron/*`. **Without it the daily digest never runs** |
| `BLOB_READ_WRITE_TOKEN` | ✅ | Injected automatically when you create a Blob store — see step 5 |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | optional | Fallback model config. Prefer the in-app per-workspace setting |
| `RESEND_API_KEY` | optional | Sends invitation e-mails. Without it, invite links are copied manually |
| `CONFERENCE_SOURCE_URL` | optional | Point the conference catalog at a different GitHub repo |
| `MAX_PDF_UPLOAD_MB` | optional | Upload size cap (default 50) |
| `S3_*` | — | Local development only; production uses Vercel Blob |

## 5. Create a Blob store for PDFs

In **Vercel → Storage → Create → Blob**, create a store and connect it to the project. Vercel injects `BLOB_READ_WRITE_TOKEN` for you.

This is not optional in practice: serverless functions have no persistent disk, and pinned PDF snapshots are what keeps annotation anchors stable when a preprint is revised.

## 6. Deploy, then create the owner account

Database migrations run automatically as part of every **production** build (`prisma migrate deploy` sits in the build command), so the schema is ready when the deploy finishes. Preview builds skip migrations on purpose.

Then open `https://your-app.vercel.app/bootstrap` and create the first account (password ≥12 characters). It becomes the workspace **owner**. The route disables itself the moment an owner exists, so it cannot be used twice.

## 7. Configure the workspace in-app

Everything else is configured in the UI, not in environment variables:

| Where | What to set |
|---|---|
| **Settings → LLM** | Your API key, base URL and model. Stored per workspace, changeable any time |
| **Settings → Preferences** | Research topics and keywords — these drive the daily digest |
| **Settings → Notifications** | Feishu webhook and the push hour (Beijing time, 0–23) |
| **Settings → Members** | Invite the rest of the group |
| **Settings → Labels** | Your shared label vocabulary |
| **Conferences → Sync** | First catalog sync (a few thousand papers; takes a minute) |

> **Model concurrency matters.** The digest analyses papers one after another and the same key serves in-app chat. On a plan limited to one concurrent request, a running digest will make chat fail until it finishes.

## 8. Make the daily push punctual (optional)

`vercel.json` ships two weekday cron entries (01:00 and 01:30 UTC = 09:00 and 09:30 Beijing). **On Vercel Hobby, cron precision is per-hour — a job scheduled for 09:00 may fire any time before 10:00.** If your group expects the card at a fixed time, add the included GitHub Actions trigger:

1. In your fork: **Settings → Secrets and variables → Actions**
   - New **secret** `CRON_SECRET` — the same value as the Vercel variable
   - New **variable** `APP_URL` — your deployment URL
2. Enable Actions on the fork. `.github/workflows/digest-trigger.yml` then calls the cron endpoint at the top of every weekday hour.

Running it alongside the Vercel crons is safe. The endpoint gates on each workspace's configured push hour and is idempotent at three levels — a run lock, a completion marker, and a claim-before-send on the Feishu card — so extra calls are no-ops and the card is still sent at most once a day.

> The same pipeline runs when someone clicks **Discover papers** manually, including the Feishu push if the day's card has not gone out yet.

## 9. Custom domain and updates

- Adding a custom domain? Update `APP_URL` (and the Actions `APP_URL` variable) or Feishu card links will still point at the old host.
- To update: pull upstream into your fork and let Vercel redeploy. Migrations apply themselves on production builds.

---

## Self-hosting without Vercel

Any Node 22 host works. You need Postgres, and either an S3-compatible bucket (`S3_*`) or Vercel Blob for PDF storage:

```bash
pnpm install
pnpm db:generate
pnpm --filter @paper-viewer/db exec prisma migrate deploy --schema prisma/schema.prisma
pnpm build
pnpm --filter @paper-viewer/web start
```

Without Vercel cron, drive the digest yourself — any scheduler that can send an hourly authenticated request will do:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/daily-digest
```

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| The digest never runs | `CRON_SECRET` is unset, or research preferences were never saved |
| The digest runs but nothing reaches Feishu | No webhook configured, or today's card was already claimed by an earlier run |
| Feishu card links point at `localhost` | `APP_URL` is unset or still holds the old domain |
| "Failed to get a reply" in chat | The model rejected the request — most often concurrency limits while a digest is running, or an invalid key in Settings → LLM |
| PDFs open from the catalog but not after upload | No Blob store connected, so there is nowhere to persist the bytes |
| Importing a `dl.acm.org` / `ieeexplore.ieee.org` link is refused | Those hosts block automated PDF fetches. Download the PDF and upload the file instead |
| Build fails on `prisma migrate deploy` | `DIRECT_URL` is missing or points at the pooled endpoint |
