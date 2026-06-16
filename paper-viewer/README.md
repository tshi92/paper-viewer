# Paper Viewer

Local-first research team paper workspace.

## Development

1. Copy `.env.example` to `.env`.
2. Run `docker compose up -d`.
3. Run `pnpm install`.
4. Run `pnpm build`.
5. Run `pnpm dev`.
6. Open `http://localhost:3000`.

`pnpm db:generate` and `pnpm db:migrate` become active after the Prisma schema task lands. Do not run them during Task 1 scaffold setup.

## Phase 1

Phase 1 supports owner bootstrap, login, workspace membership, manual PDF upload, paper library, PDF viewing, comments, and reading states.
