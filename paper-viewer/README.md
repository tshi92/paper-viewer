# Paper Viewer

Local-first research team paper workspace.

## Development

1. Copy `.env.example` to `.env`.
2. Run `docker compose up -d`.
3. Run `docker compose run --rm minio-client` to create the PDF bucket.
4. Run `pnpm install`.
5. Run `pnpm db:generate`.
6. Run `pnpm db:migrate`.
7. Run `pnpm dev`.
8. Open `http://localhost:3000`.

## Phase 1

Phase 1 supports owner bootstrap, login, workspace membership, manual PDF upload, paper library, PDF viewing, comments, and reading states.

## Local Services

Start local services:

```bash
docker compose up -d
```

Postgres runs on `localhost:5432`.
Redis runs on `localhost:6379`.
MinIO API runs on `localhost:9000`.
MinIO console runs on `localhost:9001`.

Create the PDF bucket after services start:

```bash
docker compose run --rm minio-client
```

## Verification

Run TypeScript and unit tests:

```bash
pnpm build
pnpm test
```

Run browser smoke tests:

```bash
pnpm test:e2e
```

Manual Phase 1 smoke test:

1. Start services with `docker compose up -d`.
2. Start the app with `pnpm dev`.
3. Open `http://localhost:3000/bootstrap`.
4. Create the owner account.
5. Upload a public PDF from `Library`.
6. Open the paper workspace.
7. Confirm the PDF loads.
8. Add a comment.
9. Change the reading state.
