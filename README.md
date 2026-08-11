# Paper Viewer

Research team paper workspace with daily arXiv recommendations, PDF viewing, comments, and reading states.

**Production**: https://paper-viewer-five.vercel.app

## Quick Start (Local)

```bash
# 1. Start services
docker compose up -d
docker compose run --rm minio-client

# 2. Setup
cp .env.example .env        # edit API keys
pnpm install
pnpm db:generate
pnpm db:migrate

# 3. Run
pnpm dev
# Open http://localhost:3000/bootstrap
```

## Development Workflow

### Local → Deploy

```bash
# 1. Work locally
pnpm dev                     # http://localhost:3000

# 2. Test
pnpm build && pnpm test

# 3. Commit
git add -A && git commit -m "feat: ..."

# 4. Deploy to production
pnpm deploy                  # runs: vercel deploy --prod
```

### Database Migrations

```bash
# Local: create and apply migration
pnpm db:migrate --name my_change

# Production: apply to Neon (run once after migration)
DATABASE_URL="<neon-pooler-url>" DIRECT_URL="<neon-direct-url>" \
  pnpm --filter @paper-viewer/db exec prisma migrate deploy --schema prisma/schema.prisma
```

## Architecture

| Component | Local | Production |
|-----------|-------|------------|
| App | Next.js dev server | Vercel |
| Database | Docker Postgres | Neon |
| PDF Storage | Docker MinIO | arXiv proxy (S3 optional) |
| LLM | DeepSeek V4 Pro | DeepSeek V4 Pro |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Postgres connection (pooled) |
| `DIRECT_URL` | Yes | Postgres connection (direct) |
| `AUTH_SECRET` | Yes | Session signing key (32+ chars) |
| `APP_URL` | No | App URL (default: localhost:3000) |
| `INGEST_API_KEY` | Yes | API key for paper ingest endpoint |
| `LLM_API_KEY` | Yes | DeepSeek API key |
| `LLM_BASE_URL` | No | LLM endpoint (default: deepseek) |
| `LLM_MODEL` | No | Model name (default: deepseek-v4-pro) |
| `S3_ENDPOINT` | No | MinIO/S3 endpoint (local only) |
| `S3_ACCESS_KEY_ID` | No | S3 access key |
| `S3_SECRET_ACCESS_KEY` | No | S3 secret key |
| `RESEND_API_KEY` | No | Email service for invitations |

## Features

- **Today**: Daily paper recommendations from arXiv with LLM analysis
- **Library**: Paper collection with manual PDF upload and arXiv URL import
- **Paper Workspace**: PDF viewer with text selection comments, AI chat, and keynotes
- **Preferences**: Configure research interests and arXiv categories
- **Members**: Invite team members via shareable links
