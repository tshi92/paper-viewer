# Research Paper Platform Design

Date: 2026-06-16

## Goal

Build a local-first web platform for a research team to discover, summarize, discuss, and annotate academic papers. The MVP focuses on a daily paper recommendation flow with LLM-generated analysis, PDF reading, comments, and annotations. The architecture must remain extensible enough to grow into a fuller team collaboration platform with projects, assignments, notifications, richer permissions, and knowledge-base features.

## Scope

The first version targets a single research team workspace. It should support multiple users, daily recommended papers, LLM-generated structured summaries, PDF viewing, team discussion, and PDF-linked annotations.

In this document, "MVP" means the usable internal product after Phases 1 through 4. Phase 1 is only a foundation milestone and is not expected to include the full daily recommendation and annotation loop.

The MVP should not attempt to implement every team-management feature immediately. It should, however, model users, workspaces, memberships, papers, analyses, comments, annotations, and jobs cleanly from the start so that future expansion does not require rewriting the foundation.

## Recommended Architecture

Use a local Docker Compose deployment for the first version, but design every service behind cloud-compatible interfaces.

Core services:

- `apps/web`: Next.js application for UI, API routes, authentication, and paper workspace pages.
- `apps/worker`: background job runner for paper ingestion, PDF processing, LLM analysis, and daily ranking.
- `postgres`: source of truth for users, teams, papers, analyses, comments, annotations, preferences, and job state.
- `minio`: S3-compatible object storage for PDFs and generated files.
- `redis`: queue and scheduling backend for background jobs.

This gives a straightforward migration path:

- Postgres can move to Supabase, Neon, RDS, or a self-hosted remote Postgres instance.
- MinIO can move to S3, Cloudflare R2, or Supabase Storage.
- Redis/BullMQ can move to Upstash, a managed Redis, or another queue backend.
- Next.js can run locally, in Docker, on a Node.js server, or on a managed platform.

## Product Flow

The primary product loop is feed-first:

1. Daily sources fetch candidate papers from arXiv, RSS feeds, public APIs, and manual uploads.
2. The system filters and ranks papers using team preferences, keywords, excluded topics, venues, authors, seed papers, and historical feedback.
3. Selected papers are downloaded, parsed, and analyzed by an LLM into a stable JSON schema.
4. Users read the paper in a paper workspace with the PDF, LLM analysis, comments, and annotations visible together.
5. Comments, reading states, tags, and annotations turn the paper into a team knowledge artifact.

The first screen should be `Today`, not a generic library. The platform's key habit is daily paper review and team discussion.

## MVP Modules

### Today

Shows daily recommended papers for the workspace. Each paper should display title, authors, source, publication date, topic tags, relevance score, LLM one-line summary, and reading/discussion status.

Supported actions:

- Open paper workspace.
- Save paper.
- Skip paper.
- Mark as reading, discussed, or archived.
- Add quick team comment.

### Paper Workspace

The core paper view combines:

- PDF viewer.
- LLM analysis panel.
- Team comments.
- PDF-linked annotations.
- Reading status.
- Metadata and tags.

The page should be optimized for repeated research use, not a marketing-style layout. The design should be dense, calm, and scan-friendly.

Annotations should store stable anchors, not only rendered pixel coordinates. Each annotation should include page index, normalized rectangle positions, selected text when available, short text context, and enough metadata to recover gracefully if the PDF renderer changes.

### Library

A searchable archive of all imported and recommended papers. MVP search can use Postgres metadata, text search, and JSONB filtering. Vector search should be deferred until after the core workflow works.

### Preferences

Workspace-level recommendation preferences:

- Research areas and keywords.
- Excluded topics.
- Preferred venues or sources.
- Seed papers.
- Optional authors, institutions, or labs of interest.

### Admin Jobs

A minimal operations page for ingest and analysis:

- Run daily ingest manually.
- View job status.
- Inspect failures.
- Retry PDF download, text extraction, LLM analysis, or recommendation publication.

## Permissions

Implement workspace-based permissions from the start, even if the first version has only one workspace.

Roles:

- `owner`: workspace settings, user management, LLM keys, paper source configuration.
- `admin`: paper management, jobs, team-level tags, recommendation preferences.
- `member`: read papers, comment, annotate, save papers, update personal reading state.

Future roles such as guest, project-scoped reviewer, or external collaborator should be added through the same membership foundation rather than a separate auth system.

## Data Model

Core tables:

- `users`: identity and profile.
- `workspaces`: team/lab boundary.
- `workspace_memberships`: user role per workspace.
- `research_preferences`: source, topic, keyword, seed-paper, and exclusion settings.
- `papers`: canonical paper metadata, deduplicated by DOI, arXiv ID, or other stable IDs.
- `workspace_papers`: workspace-specific paper state such as team tags, visibility, import source, and archive state.
- `paper_files`: PDF object keys, file hashes, page counts, and processing state.
- `paper_texts`: extracted page or section text for analysis and future search.
- `paper_analyses`: LLM output, model, prompt version, schema version, analysis scope, optional workspace ID, and analysis status.
- `daily_recommendations`: immutable daily feed snapshot for a workspace.
- `recommendation_feedback`: explicit user or team feedback on recommended papers.
- `comments`: workspace-scoped threaded discussion, optionally attached to a paper or annotation.
- `annotations`: workspace-scoped PDF page/range/coordinate anchors plus highlight or note content.
- `reading_states`: per-user paper state such as new, reading, saved, discussed, skipped, or archived.
- `jobs`: background job type, status, input, output, error, attempts, and timestamps.

LLM analysis should be stored separately from `papers` so the system can rerun analyses with new prompts or models without mutating canonical paper metadata.

Canonical paper records should be global within the database, while team-specific state should live on workspace-scoped tables. This avoids duplicate metadata while still allowing different teams or projects to tag, discuss, recommend, or archive the same paper independently.

LLM analyses must distinguish global paper analysis from workspace-specific analysis. General technical fields such as problem, method, experiments, and limitations can be reused across workspaces. Preference-aware fields such as relevance, suggested reviewers, and discussion prompts should be stored with a workspace scope.

## LLM Analysis Schema

The analysis output should be structured and versioned. Suggested fields:

- `one_line_summary`
- `detailed_summary`
- `problem`
- `method`
- `main_claims`
- `experiments`
- `results`
- `limitations`
- `novelty`
- `relevance_to_preferences`
- `discussion_questions`
- `reproducibility_notes`
- `code_or_data_availability`
- `suggested_reviewers`
- `topic_tags`
- `confidence`

Use a schema validation layer before saving analysis results. Failed validation should mark the analysis job as retryable rather than saving partial malformed output as final.

The schema should separate workspace-neutral fields from workspace-specific fields. That keeps a paper's technical summary reusable while allowing each research team to receive different relevance judgments and discussion prompts.

## Background Pipeline

Daily pipeline:

1. Fetch candidates from configured sources.
2. Normalize metadata and deduplicate papers.
3. Download PDFs into object storage.
4. Extract text by page and, when possible, by section.
5. Run LLM analysis with a versioned prompt and schema.
6. Rank papers against workspace preferences.
7. Publish a daily recommendation snapshot.

Each stage should be an idempotent job where practical. Jobs should record inputs, outputs, attempts, and errors so failures can be inspected and retried from the admin page.

Jobs should use stable deduplication keys such as source ID, paper ID, workspace ID, analysis schema version, and prompt version. Daily scheduling should be owned by the worker layer, with persisted job records and retry state rather than relying only on a developer machine's cron configuration.

## Technical Stack

Recommended stack:

- Next.js + TypeScript for the web application.
- Tailwind CSS and shadcn-style components for a restrained research dashboard UI.
- Postgres for all relational data and structured LLM output.
- Prisma for schema, migrations, and typed database access.
- MinIO for local S3-compatible object storage.
- Redis + BullMQ for queues and scheduling.
- PDF.js or a React PDF wrapper for PDF rendering.
- Auth.js with a Postgres adapter for local-first authentication that can migrate later.

Authentication should include an owner bootstrap path for the first local deployment and an invitation path for adding team members. Passwords or credential secrets must never be stored outside the authentication adapter's hashed/managed format.

Suggested monorepo layout:

```text
apps/
  web/
  worker/
packages/
  db/
  core/
  storage/
  ai/
  paper/
docker-compose.yml
```

Package responsibilities:

- `packages/db`: Prisma schema, migrations, database client.
- `packages/core`: domain types, permissions, paper status transitions.
- `packages/storage`: S3-compatible object adapter.
- `packages/ai`: prompt templates, schemas, LLM adapters, analysis versioning.
- `packages/paper`: source adapters, metadata normalization, PDF parsing.

## Implementation Phases

### Phase 1: Manual Paper Workspace

Build the foundation:

- Project scaffold and Docker Compose.
- Authentication.
- Workspace and membership model.
- Paper library with manual PDF upload.
- Object storage integration.
- Basic PDF viewer.
- Comments.
- Reading states.

This phase is useful for validating the paper workspace and data model, but it is not the complete MVP because it does not yet include automated ingestion, LLM analysis, daily recommendations, or PDF-linked annotations.

### Phase 2: Ingestion and Processing

Add background operations:

- Redis queue and worker.
- arXiv source adapter first, then RSS as the next source adapter.
- Metadata normalization.
- PDF download.
- Text extraction.
- Admin job console.

### Phase 3: LLM Analysis and Recommendations

Add the platform's daily intelligence:

- Versioned LLM analysis prompts.
- Schema-validated analysis output.
- Research preferences.
- Daily ranking.
- Today feed.

### Phase 4: Annotation and Search

Complete the MVP collaboration loop:

- PDF-linked highlights and notes.
- Annotation comments.
- Library search.
- Filtering by topic, status, source, and tags.
- Retry and repair flows for failed jobs.

## Deferred Features

These are intentionally out of MVP:

- Real-time collaborative cursors.
- Vector search and embeddings.
- Cross-paper synthesis maps.
- Assignment workflows and deadlines.
- Email, Slack, or calendar notifications.
- Fine-grained project-level permissions.
- Public sharing or external reviewer portals.

The data model should leave room for these features, but they should not block the first usable version.

## Security and Operations

Local-first does not mean development-only. The initial deployment should include production-shaped defaults:

- Store all secrets in environment variables and keep `.env` files out of git.
- Validate uploaded PDFs by content type, extension, size limit, and parsing success before exposing them in the viewer.
- Keep PDFs private by default and serve them through authenticated application routes or short-lived object-store URLs.
- Scope every paper workspace, comment, annotation, recommendation, and job view by workspace membership.
- Add database backup and object-store backup instructions before using the platform for real team data.
- Log background job failures with enough structured context to retry or debug them without exposing full LLM prompts or private paper text unnecessarily.

## Testing Strategy

The implementation plan should include tests at the boundaries most likely to regress:

- Unit tests for permission checks, paper status transitions, source normalization, and LLM schema validation.
- Integration tests for database migrations, object storage uploads, and queue job idempotency.
- API tests for workspace scoping, paper access, comments, annotations, and admin job actions.
- End-to-end tests for login, manual upload, opening a PDF, commenting, running an analysis job, and seeing a paper in `Today`.
- A small fixture set of public papers and PDFs for deterministic local development.

## Implementation Defaults

Use these defaults for the initial implementation plan:

- Use Prisma rather than Drizzle for the first version.
- Start with email/password authentication, owner bootstrap, and member invitations. Keep OAuth as a later extension.
- Support manual PDF upload and arXiv ingestion first. Treat RSS as the next source adapter after arXiv rather than a Phase 1 requirement.
- Implement the LLM layer as a provider adapter. Use an OpenAI-compatible provider first through environment variables, without hard-coding model names into domain logic.
- Implement initial PDF text extraction in the Node.js worker. Add a Python extraction worker later only if layout quality or parser ecosystem needs it.

## References

- Next.js deployment docs: https://nextjs.org/docs/app/getting-started/deploying
- Supabase self-hosting docs: https://supabase.com/docs/guides/self-hosting/docker
- PostgreSQL JSON docs: https://www.postgresql.org/docs/current/datatype-json.html
