# Paper Viewer

Local-first research team paper workspace.

## Development

1. Copy `.env.example` to `.env`.
2. Run `docker compose up -d`.
3. Run `pnpm install`.
4. Run `pnpm db:generate`.
5. Run `pnpm db:migrate`.
6. Run `pnpm dev`.
7. Open `http://localhost:3000`.

## Phase 1

Phase 1 supports owner bootstrap, login, workspace membership, manual PDF upload, paper library, PDF viewing, comments, and reading states.
