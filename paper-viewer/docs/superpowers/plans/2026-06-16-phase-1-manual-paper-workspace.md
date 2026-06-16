# Phase 1 Manual Paper Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 foundation for a local-first research paper workspace: local services, auth, workspace membership, manual PDF upload, paper library, PDF viewing, comments, and reading states.

**Architecture:** Use a pnpm monorepo with `apps/web` as the Next.js application and focused packages for database, core domain rules, and storage. Postgres stores all metadata and collaboration state, MinIO stores PDFs through an S3-compatible adapter, and Redis is included in Docker Compose for Phase 2 job work even though Phase 1 does not use queues yet.

**Tech Stack:** Next.js, TypeScript, Tailwind CSS, Prisma, Postgres, MinIO, Redis, signed HTTP-only session cookies, Vitest, Playwright, Docker Compose.

---

## Scope

This plan implements Phase 1 from `docs/superpowers/specs/2026-06-16-research-paper-platform-design.md`.

Included:

- Project scaffold and Docker Compose.
- Prisma schema for the full Phase 1 domain foundation.
- Owner bootstrap and email/password login.
- Workspace and membership model.
- Manual paper and PDF upload.
- S3-compatible PDF object storage.
- Paper library.
- Paper workspace with PDF viewer, comments, and reading state.
- Unit, integration, and browser smoke tests for Phase 1 boundaries.

Excluded from this plan:

- arXiv/RSS ingestion.
- Background worker jobs.
- LLM analysis.
- Daily recommendations.
- PDF-linked highlight annotations.
- Vector search.
- Notifications.

## File Structure

Create this structure:

```text
apps/
  web/
    app/
      (auth)/
        login/page.tsx
        bootstrap/page.tsx
      (dashboard)/
        layout.tsx
        library/page.tsx
        settings/members/page.tsx
        papers/[paperId]/page.tsx
      invite/[token]/page.tsx
      api/
        auth/login/route.ts
        auth/logout/route.ts
        bootstrap/route.ts
        invitations/[token]/accept/route.ts
        members/invitations/route.ts
        papers/route.ts
        papers/[paperId]/file/route.ts
        papers/[paperId]/comments/route.ts
        papers/[paperId]/reading-state/route.ts
      layout.tsx
      page.tsx
      globals.css
    components/
      app-shell.tsx
      comment-panel.tsx
      paper-upload-form.tsx
      pdf-viewer.tsx
      reading-state-select.tsx
    lib/
      auth.ts
      env.ts
      session.ts
    tests/
      auth.spec.ts
      paper-workspace.spec.ts
    next.config.mjs
    package.json
    playwright.config.ts
    postcss.config.mjs
    tailwind.config.ts
    tsconfig.json
packages/
  core/
    src/
      permissions.ts
      paper-status.ts
      validation.ts
    tests/
      permissions.test.ts
      paper-status.test.ts
    package.json
    tsconfig.json
    vitest.config.ts
  db/
    prisma/
      schema.prisma
      seed.ts
    src/
      client.ts
      schema-helpers.ts
    tests/
      schema-helpers.test.ts
    package.json
    tsconfig.json
    vitest.config.ts
  storage/
    src/
      object-storage.ts
      pdf-storage.ts
    tests/
      pdf-storage.test.ts
    package.json
    tsconfig.json
    vitest.config.ts
docker-compose.yml
package.json
pnpm-workspace.yaml
tsconfig.base.json
vitest.workspace.ts
.env.example
README.md
```

Responsibilities:

- `packages/core`: pure domain rules for permissions, reading states, and upload validation.
- `packages/db`: Prisma schema and database client. No UI code.
- `packages/storage`: S3-compatible storage adapter and PDF key generation. No Prisma imports.
- `apps/web/lib`: web-specific auth, sessions, and environment parsing.
- `apps/web/app/api`: server-side HTTP boundaries that call `core`, `db`, and `storage`.
- `apps/web/components`: UI components only. No direct Prisma access.

---

### Task 1: Scaffold Monorepo and Tooling

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `.env.example`
- Create: `README.md`
- Modify: `.gitignore`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.mjs`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/app/globals.css`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/page.tsx`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/validation.ts`
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/vitest.config.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/storage/package.json`
- Create: `packages/storage/tsconfig.json`
- Create: `packages/storage/vitest.config.ts`
- Create: `packages/storage/src/object-storage.ts`

- [ ] **Step 1: Create workspace manifests**

Create `package.json`:

```json
{
  "name": "paper-viewer",
  "private": true,
  "packageManager": "pnpm@10.30.3",
  "scripts": {
    "dev": "pnpm --filter @paper-viewer/web dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test",
    "test:e2e": "pnpm --filter @paper-viewer/web test:e2e",
    "db:generate": "pnpm --filter @paper-viewer/db prisma:generate",
    "db:migrate": "pnpm --filter @paper-viewer/db prisma:migrate",
    "db:seed": "pnpm --filter @paper-viewer/db prisma:seed"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.8"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

Create `vitest.workspace.ts`:

```ts
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/core/vitest.config.ts",
  "packages/db/vitest.config.ts",
  "packages/storage/vitest.config.ts"
]);
```

- [ ] **Step 2: Create environment template**

Create `.env.example`:

```bash
DATABASE_URL="postgresql://paper:paper@localhost:5432/paper_viewer"
DIRECT_URL="postgresql://paper:paper@localhost:5432/paper_viewer"
AUTH_SECRET="replace-with-a-32-byte-random-secret"
APP_URL="http://localhost:3000"
S3_ENDPOINT="http://localhost:9000"
S3_REGION="us-east-1"
S3_ACCESS_KEY_ID="minioadmin"
S3_SECRET_ACCESS_KEY="minioadmin"
S3_BUCKET="paper-pdfs"
S3_FORCE_PATH_STYLE="true"
MAX_PDF_UPLOAD_MB="50"
```

Append these lines to `.gitignore`:

```gitignore
.env
.next/
node_modules/
coverage/
test-results/
playwright-report/
```

Create `README.md`:

```md
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
```

- [ ] **Step 3: Create web package files**

Create `apps/web/package.json`:

```json
{
  "name": "@paper-viewer/web",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "lint": "next lint",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@paper-viewer/core": "workspace:*",
    "@paper-viewer/db": "workspace:*",
    "@paper-viewer/storage": "workspace:*",
    "@prisma/client": "^6.1.0",
    "bcryptjs": "^2.4.3",
    "lucide-react": "^0.468.0",
    "next": "^15.1.0",
    "pdfjs-dist": "^4.10.38",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@types/bcryptjs": "^2.4.6",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.0",
    "vitest": "^2.1.8"
  }
}
```

Create `apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "allowJs": false,
    "jsx": "preserve",
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Create `apps/web/next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@paper-viewer/core", "@paper-viewer/db", "@paper-viewer/storage"]
};

export default nextConfig;
```

Create `apps/web/postcss.config.mjs`:

```js
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};

export default config;
```

Create `apps/web/tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "#d8dee8",
        surface: "#f7f8fb",
        ink: "#1d2733",
        muted: "#657386",
        accent: "#256f8f"
      }
    }
  },
  plugins: []
};

export default config;
```

Create `apps/web/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: light;
}

body {
  margin: 0;
  background: #f7f8fb;
  color: #1d2733;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

a {
  color: inherit;
  text-decoration: none;
}
```

Create `apps/web/app/layout.tsx`:

```tsx
import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Paper Viewer",
  description: "Research team paper workspace"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Create `apps/web/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/library");
}
```

- [ ] **Step 4: Create package skeletons**

Create `packages/core/package.json`:

```json
{
  "name": "@paper-viewer/core",
  "private": true,
  "type": "module",
  "main": "./src/validation.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.8"
  }
}
```

Create `packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

Create `packages/core/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
```

Create `packages/core/src/validation.ts`:

```ts
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
```

Create `packages/db/package.json`:

```json
{
  "name": "@paper-viewer/db",
  "private": true,
  "type": "module",
  "main": "./src/client.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "prisma:generate": "prisma generate --schema prisma/schema.prisma",
    "prisma:migrate": "prisma migrate dev --schema prisma/schema.prisma",
    "prisma:seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "@prisma/client": "^6.1.0"
  },
  "devDependencies": {
    "prisma": "^6.1.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.0",
    "vitest": "^2.1.8"
  }
}
```

Create `packages/db/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src", "prisma", "tests"]
}
```

Create `packages/db/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
```

Create `packages/db/src/client.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

Create `packages/storage/package.json`:

```json
{
  "name": "@paper-viewer/storage",
  "private": true,
  "type": "module",
  "main": "./src/object-storage.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.716.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.8"
  }
}
```

Create `packages/storage/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

Create `packages/storage/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
```

Create `packages/storage/src/object-storage.ts`:

```ts
export type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
};

export type StoredObject = {
  key: string;
  contentType: string;
  byteLength: number;
};
```

- [ ] **Step 5: Install dependencies**

Run:

```bash
pnpm install
```

Expected: lockfile is created and dependencies install successfully.

- [ ] **Step 6: Verify scaffold**

Run:

```bash
pnpm build
```

Expected: TypeScript builds every package. If Next.js asks for `next-env.d.ts`, run `pnpm --filter @paper-viewer/web dev` once, stop it after it creates the file, then rerun `pnpm build`.

- [ ] **Step 7: Commit scaffold**

Run:

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json vitest.workspace.ts .env.example README.md apps packages
git commit -m "feat: scaffold paper workspace monorepo"
```

---

### Task 2: Add Local Services with Docker Compose

**Files:**

- Create: `docker-compose.yml`
- Modify: `README.md`

- [ ] **Step 1: Create Docker Compose services**

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: paper-viewer-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: paper
      POSTGRES_PASSWORD: paper
      POSTGRES_DB: paper_viewer
    ports:
      - "5432:5432"
    volumes:
      - paper_viewer_postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U paper -d paper_viewer"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: paper-viewer-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - paper_viewer_redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  minio:
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
    container_name: paper-viewer-minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - paper_viewer_minio:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  paper_viewer_postgres:
  paper_viewer_redis:
  paper_viewer_minio:
```

- [ ] **Step 2: Update README service instructions**

Append this section to `README.md`:

````md
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
docker compose exec minio mc alias set local http://localhost:9000 minioadmin minioadmin
docker compose exec minio mc mb --ignore-existing local/paper-pdfs
```
````

- [ ] **Step 3: Start services**

Run:

```bash
docker compose up -d
docker compose ps
```

Expected: `postgres`, `redis`, and `minio` show as running or healthy.

- [ ] **Step 4: Create MinIO bucket**

Run:

```bash
docker compose exec minio mc alias set local http://localhost:9000 minioadmin minioadmin
docker compose exec minio mc mb --ignore-existing local/paper-pdfs
```

Expected: bucket `paper-pdfs` exists.

- [ ] **Step 5: Commit local services**

Run:

```bash
git add docker-compose.yml README.md
git commit -m "feat: add local service stack"
```

---

### Task 3: Define Domain Rules and Prisma Schema

**Files:**

- Create: `packages/core/src/permissions.ts`
- Create: `packages/core/src/paper-status.ts`
- Create: `packages/core/tests/permissions.test.ts`
- Create: `packages/core/tests/paper-status.test.ts`
- Create: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/seed.ts`
- Create: `packages/db/src/schema-helpers.ts`
- Create: `packages/db/tests/schema-helpers.test.ts`

- [ ] **Step 1: Write permission tests**

Create `packages/core/tests/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canManageWorkspace, canReadWorkspace, canWritePaper } from "../src/permissions";

describe("permissions", () => {
  it("allows owners to manage the workspace", () => {
    expect(canManageWorkspace("owner")).toBe(true);
    expect(canManageWorkspace("admin")).toBe(false);
    expect(canManageWorkspace("member")).toBe(false);
  });

  it("allows all workspace roles to read and write paper collaboration data", () => {
    expect(canReadWorkspace("owner")).toBe(true);
    expect(canReadWorkspace("admin")).toBe(true);
    expect(canReadWorkspace("member")).toBe(true);
    expect(canWritePaper("owner")).toBe(true);
    expect(canWritePaper("admin")).toBe(true);
    expect(canWritePaper("member")).toBe(true);
  });

  it("rejects missing membership", () => {
    expect(canReadWorkspace(null)).toBe(false);
    expect(canWritePaper(null)).toBe(false);
    expect(canManageWorkspace(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement permissions**

Create `packages/core/src/permissions.ts`:

```ts
export type WorkspaceRole = "owner" | "admin" | "member";

export function canReadWorkspace(role: WorkspaceRole | null): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

export function canWritePaper(role: WorkspaceRole | null): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

export function canManageWorkspace(role: WorkspaceRole | null): boolean {
  return role === "owner";
}
```

- [ ] **Step 3: Write reading state tests**

Create `packages/core/tests/paper-status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isReadingState, readingStates } from "../src/paper-status";

describe("paper status", () => {
  it("contains the Phase 1 reading states", () => {
    expect(readingStates).toEqual(["new", "reading", "saved", "discussed", "skipped", "archived"]);
  });

  it("validates reading states", () => {
    expect(isReadingState("reading")).toBe(true);
    expect(isReadingState("invalid")).toBe(false);
  });
});
```

- [ ] **Step 4: Implement reading states**

Create `packages/core/src/paper-status.ts`:

```ts
export const readingStates = ["new", "reading", "saved", "discussed", "skipped", "archived"] as const;

export type ReadingState = (typeof readingStates)[number];

export function isReadingState(value: string): value is ReadingState {
  return readingStates.includes(value as ReadingState);
}
```

- [ ] **Step 5: Write schema helper tests**

Create `packages/db/tests/schema-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizePaperIdentity } from "../src/schema-helpers";

describe("normalizePaperIdentity", () => {
  it("normalizes arXiv identifiers and DOI values", () => {
    expect(normalizePaperIdentity({ arxivId: " arXiv:2401.00001 ", doi: " 10.1000/ABC " })).toEqual({
      arxivId: "2401.00001",
      doi: "10.1000/abc"
    });
  });

  it("keeps missing identifiers as null", () => {
    expect(normalizePaperIdentity({ arxivId: "", doi: undefined })).toEqual({
      arxivId: null,
      doi: null
    });
  });
});
```

- [ ] **Step 6: Implement schema helper**

Create `packages/db/src/schema-helpers.ts`:

```ts
export type PaperIdentityInput = {
  arxivId?: string | null;
  doi?: string | null;
};

export type NormalizedPaperIdentity = {
  arxivId: string | null;
  doi: string | null;
};

export function normalizePaperIdentity(input: PaperIdentityInput): NormalizedPaperIdentity {
  const arxivId = input.arxivId?.trim().replace(/^arxiv:/i, "") || null;
  const doi = input.doi?.trim().toLowerCase() || null;

  return { arxivId, doi };
}
```

- [ ] **Step 7: Run unit tests and verify they pass**

Run:

```bash
pnpm --filter @paper-viewer/core test
pnpm --filter @paper-viewer/db test
```

Expected: all tests pass.

- [ ] **Step 8: Create Prisma schema**

Create `packages/db/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

enum WorkspaceRole {
  owner
  admin
  member
}

enum ReadingState {
  new
  reading
  saved
  discussed
  skipped
  archived
}

enum WorkspacePaperState {
  visible
  archived
}

enum PaperFileStatus {
  uploaded
  processing
  ready
  failed
}

model User {
  id             String                @id @default(cuid())
  email          String                @unique
  name           String?
  passwordHash   String
  createdAt      DateTime              @default(now())
  updatedAt      DateTime              @updatedAt
  memberships    WorkspaceMembership[]
  comments       Comment[]
  readingStates  ReadingStateRecord[]
}

model Workspace {
  id              String                @id @default(cuid())
  name            String
  createdAt       DateTime              @default(now())
  updatedAt       DateTime              @updatedAt
  memberships     WorkspaceMembership[]
  invitations     Invitation[]
  workspacePapers WorkspacePaper[]
  comments        Comment[]
  readingStates   ReadingStateRecord[]
}

model WorkspaceMembership {
  id          String        @id @default(cuid())
  workspaceId String
  userId      String
  role        WorkspaceRole
  createdAt   DateTime      @default(now())
  workspace   Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, userId])
  @@index([userId])
}

model Invitation {
  id          String        @id @default(cuid())
  workspaceId String
  email       String
  role        WorkspaceRole
  tokenHash   String        @unique
  acceptedAt  DateTime?
  expiresAt   DateTime
  createdAt   DateTime      @default(now())
  workspace   Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, email])
}

model Paper {
  id              String           @id @default(cuid())
  title           String
  abstract        String?
  authors         Json
  source          String
  sourceId        String?
  doi             String?
  arxivId         String?
  publishedAt     DateTime?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
  files           PaperFile[]
  workspacePapers WorkspacePaper[]
  comments        Comment[]
  readingStates   ReadingStateRecord[]

  @@unique([source, sourceId])
  @@unique([doi])
  @@unique([arxivId])
}

model WorkspacePaper {
  id          String              @id @default(cuid())
  workspaceId String
  paperId     String
  state       WorkspacePaperState @default(visible)
  tags        String[]            @default([])
  importedBy  String?
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
  workspace   Workspace           @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  paper       Paper               @relation(fields: [paperId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, paperId])
  @@index([paperId])
}

model PaperFile {
  id          String          @id @default(cuid())
  paperId     String
  objectKey   String          @unique
  fileName    String
  contentType String
  byteLength  Int
  sha256      String
  pageCount   Int?
  status      PaperFileStatus @default(uploaded)
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  paper       Paper           @relation(fields: [paperId], references: [id], onDelete: Cascade)
}

model Comment {
  id          String     @id @default(cuid())
  workspaceId String
  paperId     String
  authorId    String
  parentId    String?
  body        String
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  workspace   Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  paper       Paper      @relation(fields: [paperId], references: [id], onDelete: Cascade)
  author      User       @relation(fields: [authorId], references: [id], onDelete: Cascade)
  parent      Comment?   @relation("CommentThread", fields: [parentId], references: [id], onDelete: Cascade)
  replies     Comment[]  @relation("CommentThread")

  @@index([workspaceId, paperId])
  @@index([authorId])
}

model ReadingStateRecord {
  id          String       @id @default(cuid())
  workspaceId String
  paperId     String
  userId      String
  state       ReadingState @default(new)
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  workspace   Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  paper       Paper        @relation(fields: [paperId], references: [id], onDelete: Cascade)
  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, paperId, userId])
  @@index([userId])
}
```

- [ ] **Step 9: Add seed script**

Create `packages/db/prisma/seed.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const existingWorkspace = await prisma.workspace.findFirst();
  if (existingWorkspace) {
    return;
  }

  await prisma.workspace.create({
    data: {
      name: "Research Team"
    }
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 10: Generate and migrate database**

Run:

```bash
pnpm db:generate
pnpm db:migrate --name phase_1_foundation
```

Expected: Prisma Client is generated and a migration is created under `packages/db/prisma/migrations`.

- [ ] **Step 11: Commit domain and schema**

Run:

```bash
git add packages/core packages/db
git commit -m "feat: add workspace paper domain schema"
```

---

### Task 4: Implement Auth, Sessions, and Owner Bootstrap

**Files:**

- Create: `apps/web/lib/env.ts`
- Create: `apps/web/lib/session.ts`
- Create: `apps/web/lib/auth.ts`
- Create: `apps/web/app/(auth)/bootstrap/page.tsx`
- Create: `apps/web/app/(auth)/login/page.tsx`
- Create: `apps/web/app/invite/[token]/page.tsx`
- Create: `apps/web/app/api/bootstrap/route.ts`
- Create: `apps/web/app/api/auth/login/route.ts`
- Create: `apps/web/app/api/auth/logout/route.ts`
- Create: `apps/web/app/api/members/invitations/route.ts`
- Create: `apps/web/app/api/invitations/[token]/accept/route.ts`
- Create: `apps/web/app/(dashboard)/layout.tsx`
- Create: `apps/web/app/(dashboard)/settings/members/page.tsx`
- Create: `apps/web/components/app-shell.tsx`
- Create: `apps/web/tests/auth.spec.ts`

- [ ] **Step 1: Create environment parser**

Create `apps/web/lib/env.ts`:

```ts
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(16),
  APP_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true"),
  MAX_PDF_UPLOAD_MB: z.coerce.number().int().positive().default(50)
});

export const env = envSchema.parse(process.env);
```

- [ ] **Step 2: Implement session cookie helpers**

Create `apps/web/lib/session.ts`:

```ts
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

const cookieName = "paper_viewer_session";

type SessionPayload = {
  userId: string;
};

function sign(value: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(value).digest("base64url");
}

export function createSessionToken(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readSessionToken(token: string | undefined): SessionPayload | null {
  if (!token) {
    return null;
  }

  const [body, signature] = token.split(".");
  if (!body || !signature) {
    return null;
  }

  const expected = sign(body);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
}

export async function setSession(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(cookieName, createSessionToken({ userId }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(cookieName);
}

export async function getSessionPayload(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  return readSessionToken(cookieStore.get(cookieName)?.value);
}
```

- [ ] **Step 3: Implement auth helpers**

Create `apps/web/lib/auth.ts`:

```ts
import { prisma } from "@paper-viewer/db/src/client";
import type { WorkspaceRole } from "@paper-viewer/core/src/permissions";
import { getSessionPayload } from "./session";

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  workspaceId: string;
  role: WorkspaceRole;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const payload = await getSessionPayload();
  if (!payload) {
    return null;
  }

  const membership = await prisma.workspaceMembership.findFirst({
    where: { userId: payload.userId },
    include: { user: true }
  });

  if (!membership) {
    return null;
  }

  return {
    id: membership.user.id,
    email: membership.user.email,
    name: membership.user.name,
    workspaceId: membership.workspaceId,
    role: membership.role
  };
}

export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Authentication required");
  }
  return user;
}
```

- [ ] **Step 4: Create bootstrap and login pages**

Create `apps/web/app/(auth)/bootstrap/page.tsx`:

```tsx
export default function BootstrapPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Create owner account</h1>
      <form className="mt-6 grid gap-4" method="post" action="/api/bootstrap">
        <input className="rounded border border-border px-3 py-2" name="name" placeholder="Name" required />
        <input className="rounded border border-border px-3 py-2" name="email" placeholder="Email" type="email" required />
        <input className="rounded border border-border px-3 py-2" name="password" placeholder="Password" type="password" required minLength={12} />
        <button className="rounded bg-accent px-3 py-2 font-medium text-white" type="submit">Create workspace</button>
      </form>
    </main>
  );
}
```

Create `apps/web/app/(auth)/login/page.tsx`:

```tsx
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <form className="mt-6 grid gap-4" method="post" action="/api/auth/login">
        <input className="rounded border border-border px-3 py-2" name="email" placeholder="Email" type="email" required />
        <input className="rounded border border-border px-3 py-2" name="password" placeholder="Password" type="password" required />
        <button className="rounded bg-accent px-3 py-2 font-medium text-white" type="submit">Sign in</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Create bootstrap route**

Create `apps/web/app/api/bootstrap/route.ts`:

```ts
import { prisma } from "@paper-viewer/db/src/client";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { setSession } from "@/lib/session";

const bootstrapSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(12)
});

export async function POST(request: Request) {
  const existingOwner = await prisma.workspaceMembership.findFirst({
    where: { role: "owner" }
  });

  if (existingOwner) {
    redirect("/login");
  }

  const formData = await request.formData();
  const input = bootstrapSchema.parse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password")
  });

  const passwordHash = await bcrypt.hash(input.password, 12);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash,
      memberships: {
        create: {
          role: "owner",
          workspace: {
            create: {
              name: "Research Team"
            }
          }
        }
      }
    }
  });

  await setSession(user.id);
  redirect("/library");
}
```

- [ ] **Step 6: Create login and logout routes**

Create `apps/web/app/api/auth/login/route.ts`:

```ts
import { prisma } from "@paper-viewer/db/src/client";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { setSession } from "@/lib/session";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function POST(request: Request) {
  const formData = await request.formData();
  const input = loginSchema.parse({
    email: formData.get("email"),
    password: formData.get("password")
  });

  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() }
  });

  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    redirect("/login");
  }

  await setSession(user.id);
  redirect("/library");
}
```

Create `apps/web/app/api/auth/logout/route.ts`:

```ts
import { redirect } from "next/navigation";
import { clearSession } from "@/lib/session";

export async function POST() {
  await clearSession();
  redirect("/login");
}
```

- [ ] **Step 7: Create dashboard shell**

Create `apps/web/components/app-shell.tsx`:

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth";

export function AppShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <nav className="flex items-center gap-5 text-sm">
            <Link className="font-semibold" href="/library">Paper Viewer</Link>
            <Link href="/library">Library</Link>
            {user.role === "owner" ? <Link href="/settings/members">Members</Link> : null}
          </nav>
          <div className="flex items-center gap-3 text-sm text-muted">
            <span>{user.email}</span>
            <form action="/api/auth/logout" method="post">
              <button className="rounded border border-border px-3 py-1" type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
```

Create `apps/web/app/(dashboard)/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return <AppShell user={user}>{children}</AppShell>;
}
```

- [ ] **Step 8: Create owner member invitation page**

Create `apps/web/app/(dashboard)/settings/members/page.tsx`:

```tsx
import { prisma } from "@paper-viewer/db/src/client";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";

export default async function MembersPage({
  searchParams
}: {
  searchParams: Promise<{ invitation?: string }>;
}) {
  const user = await requireCurrentUser();
  const { invitation } = await searchParams;

  if (user.role !== "owner") {
    redirect("/library");
  }

  const [memberships, invitations] = await Promise.all([
    prisma.workspaceMembership.findMany({
      where: { workspaceId: user.workspaceId },
      include: { user: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.invitation.findMany({
      where: {
        workspaceId: user.workspaceId,
        acceptedAt: null
      },
      orderBy: { createdAt: "desc" }
    })
  ]);

  return (
    <div className="grid grid-cols-[360px_1fr] gap-6">
      <form className="grid gap-3 rounded border border-border bg-white p-4" action="/api/members/invitations" method="post">
        <h1 className="text-lg font-semibold">Invite member</h1>
        <input className="rounded border border-border px-3 py-2" name="email" placeholder="Email" type="email" required />
        <select className="rounded border border-border px-3 py-2" name="role" defaultValue="member">
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
        <button className="rounded bg-accent px-3 py-2 font-medium text-white" type="submit">Create invitation</button>
        {invitation ? (
          <p className="break-all rounded bg-surface p-3 text-sm text-muted">
            Invitation link: {`/invite/${invitation}`}
          </p>
        ) : null}
      </form>

      <section className="grid gap-4">
        <div className="rounded border border-border bg-white">
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-semibold">Members</h2>
          </div>
          <div className="divide-y divide-border">
            {memberships.map((membership) => (
              <div className="flex items-center justify-between px-4 py-3" key={membership.id}>
                <span>{membership.user.email}</span>
                <span className="text-sm text-muted">{membership.role}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded border border-border bg-white">
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-semibold">Open invitations</h2>
          </div>
          <div className="divide-y divide-border">
            {invitations.map((invitation) => (
              <div className="px-4 py-3" key={invitation.id}>
                <div className="font-medium">{invitation.email}</div>
                <div className="text-sm text-muted">{invitation.role}</div>
              </div>
            ))}
            {invitations.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No open invitations.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 9: Create invitation creation route**

Create `apps/web/app/api/members/invitations/route.ts`:

```ts
import { prisma } from "@paper-viewer/db/src/client";
import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";

const invitationSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"])
});

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(request: Request) {
  const user = await requireCurrentUser();
  if (user.role !== "owner") {
    return new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const input = invitationSchema.parse({
    email: formData.get("email"),
    role: formData.get("role")
  });

  const token = randomBytes(32).toString("base64url");
  await prisma.invitation.create({
    data: {
      workspaceId: user.workspaceId,
      email: input.email.toLowerCase(),
      role: input.role,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  });

  redirect(`/settings/members?invitation=${encodeURIComponent(token)}`);
}
```

- [ ] **Step 10: Create invitation acceptance page**

Create `apps/web/app/invite/[token]/page.tsx`:

```tsx
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Accept invitation</h1>
      <form className="mt-6 grid gap-4" method="post" action={`/api/invitations/${token}/accept`}>
        <input className="rounded border border-border px-3 py-2" name="name" placeholder="Name" required />
        <input className="rounded border border-border px-3 py-2" name="password" placeholder="Password" type="password" required minLength={12} />
        <button className="rounded bg-accent px-3 py-2 font-medium text-white" type="submit">Join workspace</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 11: Create invitation acceptance route**

Create `apps/web/app/api/invitations/[token]/accept/route.ts`:

```ts
import { prisma } from "@paper-viewer/db/src/client";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { setSession } from "@/lib/session";

const acceptInvitationSchema = z.object({
  name: z.string().min(1),
  password: z.string().min(12)
});

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const formData = await request.formData();
  const input = acceptInvitationSchema.parse({
    name: formData.get("name"),
    password: formData.get("password")
  });

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) }
  });

  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    return new Response("Invitation is invalid or expired", { status: 400 });
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({
    data: {
      email: invitation.email,
      name: input.name,
      passwordHash,
      memberships: {
        create: {
          workspaceId: invitation.workspaceId,
          role: invitation.role
        }
      }
    }
  });

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { acceptedAt: new Date() }
  });

  await setSession(user.id);
  redirect("/library");
}
```

- [ ] **Step 12: Add Playwright auth smoke test**

Create `apps/web/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true
  }
});
```

Create `apps/web/tests/auth.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
```

- [ ] **Step 13: Verify auth code**

Run:

```bash
pnpm build
pnpm test:e2e -- tests/auth.spec.ts
```

Expected: build succeeds and the login page test passes.

- [ ] **Step 14: Commit auth foundation**

Run:

```bash
git add apps/web
git commit -m "feat: add owner bootstrap and login"
```

---

### Task 5: Implement PDF Storage and Upload Validation

**Files:**

- Create: `packages/core/tests/upload-validation.test.ts`
- Create: `packages/core/src/upload-validation.ts`
- Create: `packages/storage/src/pdf-storage.ts`
- Create: `packages/storage/tests/pdf-storage.test.ts`

- [ ] **Step 1: Write upload validation tests**

Create `packages/core/tests/upload-validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validatePdfUpload } from "../src/upload-validation";

describe("validatePdfUpload", () => {
  it("accepts PDF uploads under the configured size limit", () => {
    expect(
      validatePdfUpload({
        fileName: "paper.pdf",
        contentType: "application/pdf",
        byteLength: 1024,
        maxBytes: 10_000
      })
    ).toEqual({ ok: true });
  });

  it("rejects non-PDF files", () => {
    expect(
      validatePdfUpload({
        fileName: "paper.txt",
        contentType: "text/plain",
        byteLength: 1024,
        maxBytes: 10_000
      })
    ).toEqual({ ok: false, reason: "Only PDF files are supported." });
  });

  it("rejects oversized PDFs", () => {
    expect(
      validatePdfUpload({
        fileName: "paper.pdf",
        contentType: "application/pdf",
        byteLength: 20_000,
        maxBytes: 10_000
      })
    ).toEqual({ ok: false, reason: "PDF exceeds the configured size limit." });
  });
});
```

- [ ] **Step 2: Implement upload validation**

Create `packages/core/src/upload-validation.ts`:

```ts
type UploadInput = {
  fileName: string;
  contentType: string;
  byteLength: number;
  maxBytes: number;
};

type UploadValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
    };

export function validatePdfUpload(input: UploadInput): UploadValidationResult {
  const lowerName = input.fileName.toLowerCase();
  if (!lowerName.endsWith(".pdf") || input.contentType !== "application/pdf") {
    return { ok: false, reason: "Only PDF files are supported." };
  }

  if (input.byteLength > input.maxBytes) {
    return { ok: false, reason: "PDF exceeds the configured size limit." };
  }

  return { ok: true };
}
```

- [ ] **Step 3: Write storage key tests**

Create `packages/storage/tests/pdf-storage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createPdfObjectKey } from "../src/pdf-storage";

describe("createPdfObjectKey", () => {
  it("creates workspace and paper scoped PDF keys", () => {
    expect(createPdfObjectKey({ workspaceId: "w1", paperId: "p1", sha256: "abc123" })).toBe(
      "workspaces/w1/papers/p1/files/abc123.pdf"
    );
  });
});
```

- [ ] **Step 4: Implement storage adapter**

Create `packages/storage/src/pdf-storage.ts`:

```ts
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ObjectStorageConfig, StoredObject } from "./object-storage";

export type PdfObjectKeyInput = {
  workspaceId: string;
  paperId: string;
  sha256: string;
};

export function createPdfObjectKey(input: PdfObjectKeyInput): string {
  return `workspaces/${input.workspaceId}/papers/${input.paperId}/files/${input.sha256}.pdf`;
}

export function createS3Client(config: ObjectStorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
}

export async function putPdfObject(params: {
  client: S3Client;
  bucket: string;
  key: string;
  body: Uint8Array;
  contentType: string;
}): Promise<StoredObject> {
  await params.client.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType
    })
  );

  return {
    key: params.key,
    contentType: params.contentType,
    byteLength: params.body.byteLength
  };
}

export async function getPdfObject(params: { client: S3Client; bucket: string; key: string }) {
  return params.client.send(
    new GetObjectCommand({
      Bucket: params.bucket,
      Key: params.key
    })
  );
}
```

- [ ] **Step 5: Run package tests**

Run:

```bash
pnpm --filter @paper-viewer/core test
pnpm --filter @paper-viewer/storage test
```

Expected: upload validation and storage key tests pass.

- [ ] **Step 6: Commit storage foundation**

Run:

```bash
git add packages/core packages/storage
git commit -m "feat: add pdf upload validation and storage adapter"
```

---

### Task 6: Build Manual Paper Upload and Library

**Files:**

- Create: `apps/web/components/paper-upload-form.tsx`
- Create: `apps/web/app/api/papers/route.ts`
- Create: `apps/web/app/(dashboard)/library/page.tsx`

- [ ] **Step 1: Create upload form**

Create `apps/web/components/paper-upload-form.tsx`:

```tsx
export function PaperUploadForm() {
  return (
    <form className="grid gap-3 rounded border border-border bg-white p-4" action="/api/papers" method="post" encType="multipart/form-data">
      <h2 className="text-base font-semibold">Upload paper</h2>
      <input className="rounded border border-border px-3 py-2" name="title" placeholder="Paper title" required />
      <textarea className="min-h-24 rounded border border-border px-3 py-2" name="abstract" placeholder="Abstract" />
      <input className="rounded border border-border px-3 py-2" name="authors" placeholder="Authors, comma separated" required />
      <input className="rounded border border-border px-3 py-2" name="pdf" type="file" accept="application/pdf" required />
      <button className="rounded bg-accent px-3 py-2 font-medium text-white" type="submit">Upload</button>
    </form>
  );
}
```

- [ ] **Step 2: Create upload API route**

Create `apps/web/app/api/papers/route.ts`:

```ts
import { validatePdfUpload } from "@paper-viewer/core/src/upload-validation";
import { prisma } from "@paper-viewer/db/src/client";
import { createPdfObjectKey, createS3Client, putPdfObject } from "@paper-viewer/storage/src/pdf-storage";
import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";

const paperInputSchema = z.object({
  title: z.string().min(1),
  abstract: z.string().optional(),
  authors: z.string().min(1)
});

export async function POST(request: Request) {
  const user = await requireCurrentUser();
  const formData = await request.formData();
  const file = formData.get("pdf");

  if (!(file instanceof File)) {
    return new Response("PDF file is required", { status: 400 });
  }

  const input = paperInputSchema.parse({
    title: formData.get("title"),
    abstract: formData.get("abstract")?.toString() || undefined,
    authors: formData.get("authors")
  });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validatePdfUpload({
    fileName: file.name,
    contentType: file.type,
    byteLength: bytes.byteLength,
    maxBytes: env.MAX_PDF_UPLOAD_MB * 1024 * 1024
  });

  if (!validation.ok) {
    return new Response(validation.reason, { status: 400 });
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const authors = input.authors.split(",").map((author) => author.trim()).filter(Boolean);

  const paper = await prisma.paper.create({
    data: {
      title: input.title,
      abstract: input.abstract,
      authors,
      source: "manual",
      workspacePapers: {
        create: {
          workspaceId: user.workspaceId,
          importedBy: user.id
        }
      }
    }
  });

  const objectKey = createPdfObjectKey({
    workspaceId: user.workspaceId,
    paperId: paper.id,
    sha256
  });

  const client = createS3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    bucket: env.S3_BUCKET,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true"
  });

  await putPdfObject({
    client,
    bucket: env.S3_BUCKET,
    key: objectKey,
    body: bytes,
    contentType: "application/pdf"
  });

  await prisma.paperFile.create({
    data: {
      paperId: paper.id,
      objectKey,
      fileName: file.name,
      contentType: "application/pdf",
      byteLength: bytes.byteLength,
      sha256,
      status: "ready"
    }
  });

  redirect(`/papers/${paper.id}`);
}
```

- [ ] **Step 3: Create library page**

Create `apps/web/app/(dashboard)/library/page.tsx`:

```tsx
import Link from "next/link";
import { prisma } from "@paper-viewer/db/src/client";
import { PaperUploadForm } from "@/components/paper-upload-form";
import { requireCurrentUser } from "@/lib/auth";

export default async function LibraryPage() {
  const user = await requireCurrentUser();
  const workspacePapers = await prisma.workspacePaper.findMany({
    where: {
      workspaceId: user.workspaceId,
      state: "visible"
    },
    include: {
      paper: {
        include: {
          files: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return (
    <div className="grid grid-cols-[360px_1fr] gap-6">
      <PaperUploadForm />
      <section className="rounded border border-border bg-white">
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold">Library</h1>
        </div>
        <div className="divide-y divide-border">
          {workspacePapers.map(({ paper }) => (
            <Link className="block px-4 py-4 hover:bg-surface" href={`/papers/${paper.id}`} key={paper.id}>
              <h2 className="font-medium">{paper.title}</h2>
              <p className="mt-1 text-sm text-muted">{Array.isArray(paper.authors) ? paper.authors.join(", ") : ""}</p>
              <p className="mt-2 text-sm text-muted">{paper.files.length > 0 ? "PDF ready" : "No PDF"}</p>
            </Link>
          ))}
          {workspacePapers.length === 0 ? <p className="px-4 py-8 text-sm text-muted">No papers uploaded yet.</p> : null}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Verify upload flow manually**

Run:

```bash
pnpm dev
```

Expected:

- `http://localhost:3000/bootstrap` can create the first owner.
- `http://localhost:3000/library` shows upload form.
- Uploading a small public PDF redirects to `/papers/<paperId>`.

- [ ] **Step 5: Commit library upload**

Run:

```bash
git add apps/web/components/paper-upload-form.tsx apps/web/app/api/papers/route.ts apps/web/app/\(dashboard\)/library/page.tsx
git commit -m "feat: add manual paper upload and library"
```

---

### Task 7: Build Paper Workspace, PDF Serving, Comments, and Reading State

**Files:**

- Create: `apps/web/app/api/papers/[paperId]/file/route.ts`
- Create: `apps/web/app/api/papers/[paperId]/comments/route.ts`
- Create: `apps/web/app/api/papers/[paperId]/reading-state/route.ts`
- Create: `apps/web/components/pdf-viewer.tsx`
- Create: `apps/web/components/comment-panel.tsx`
- Create: `apps/web/components/reading-state-select.tsx`
- Create: `apps/web/app/(dashboard)/papers/[paperId]/page.tsx`

- [ ] **Step 1: Create authenticated PDF file route**

Create `apps/web/app/api/papers/[paperId]/file/route.ts`:

```ts
import { prisma } from "@paper-viewer/db/src/client";
import { createS3Client, getPdfObject } from "@paper-viewer/storage/src/pdf-storage";
import { requireCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";

export async function GET(_request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

  const workspacePaper = await prisma.workspacePaper.findUnique({
    where: {
      workspaceId_paperId: {
        workspaceId: user.workspaceId,
        paperId
      }
    },
    include: {
      paper: {
        include: {
          files: {
            orderBy: { createdAt: "desc" },
            take: 1
          }
        }
      }
    }
  });

  const file = workspacePaper?.paper.files[0];
  if (!file) {
    return new Response("PDF not found", { status: 404 });
  }

  const client = createS3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    bucket: env.S3_BUCKET,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true"
  });

  const object = await getPdfObject({ client, bucket: env.S3_BUCKET, key: file.objectKey });
  const bytes = await object.Body?.transformToByteArray();

  if (!bytes) {
    return new Response("PDF content unavailable", { status: 500 });
  }

  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${file.fileName.replaceAll("\"", "")}"`
    }
  });
}
```

- [ ] **Step 2: Create PDF viewer component**

Create `apps/web/components/pdf-viewer.tsx`:

```tsx
"use client";

export function PdfViewer({ paperId }: { paperId: string }) {
  return (
    <iframe
      className="h-[calc(100vh-180px)] w-full rounded border border-border bg-white"
      src={`/api/papers/${paperId}/file`}
      title="Paper PDF"
    />
  );
}
```

- [ ] **Step 3: Create comments route**

Create `apps/web/app/api/papers/[paperId]/comments/route.ts`:

```ts
import { prisma } from "@paper-viewer/db/src/client";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";

const commentSchema = z.object({
  body: z.string().min(1).max(5000)
});

export async function POST(request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

  const workspacePaper = await prisma.workspacePaper.findUnique({
    where: {
      workspaceId_paperId: {
        workspaceId: user.workspaceId,
        paperId
      }
    }
  });

  if (!workspacePaper) {
    return new Response("Paper not found", { status: 404 });
  }

  const formData = await request.formData();
  const input = commentSchema.parse({
    body: formData.get("body")
  });

  await prisma.comment.create({
    data: {
      workspaceId: user.workspaceId,
      paperId,
      authorId: user.id,
      body: input.body
    }
  });

  redirect(`/papers/${paperId}`);
}
```

- [ ] **Step 4: Create reading state route**

Create `apps/web/app/api/papers/[paperId]/reading-state/route.ts`:

```ts
import { isReadingState } from "@paper-viewer/core/src/paper-status";
import { prisma } from "@paper-viewer/db/src/client";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;
  const formData = await request.formData();
  const state = formData.get("state")?.toString() ?? "";

  if (!isReadingState(state)) {
    return new Response("Invalid reading state", { status: 400 });
  }

  const workspacePaper = await prisma.workspacePaper.findUnique({
    where: {
      workspaceId_paperId: {
        workspaceId: user.workspaceId,
        paperId
      }
    }
  });

  if (!workspacePaper) {
    return new Response("Paper not found", { status: 404 });
  }

  await prisma.readingStateRecord.upsert({
    where: {
      workspaceId_paperId_userId: {
        workspaceId: user.workspaceId,
        paperId,
        userId: user.id
      }
    },
    update: { state },
    create: {
      workspaceId: user.workspaceId,
      paperId,
      userId: user.id,
      state
    }
  });

  redirect(`/papers/${paperId}`);
}
```

- [ ] **Step 5: Create comments and reading UI**

Create `apps/web/components/comment-panel.tsx`:

```tsx
type CommentView = {
  id: string;
  body: string;
  createdAt: Date;
  author: {
    email: string;
    name: string | null;
  };
};

export function CommentPanel({ paperId, comments }: { paperId: string; comments: CommentView[] }) {
  return (
    <section className="rounded border border-border bg-white">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-semibold">Discussion</h2>
      </div>
      <div className="max-h-80 divide-y divide-border overflow-auto">
        {comments.map((comment) => (
          <article className="px-4 py-3" key={comment.id}>
            <div className="text-xs text-muted">{comment.author.name ?? comment.author.email}</div>
            <p className="mt-1 text-sm">{comment.body}</p>
          </article>
        ))}
        {comments.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No comments yet.</p> : null}
      </div>
      <form className="grid gap-2 border-t border-border p-4" action={`/api/papers/${paperId}/comments`} method="post">
        <textarea className="min-h-24 rounded border border-border px-3 py-2" name="body" placeholder="Add a comment" required />
        <button className="rounded bg-accent px-3 py-2 text-sm font-medium text-white" type="submit">Comment</button>
      </form>
    </section>
  );
}
```

Create `apps/web/components/reading-state-select.tsx`:

```tsx
import { readingStates, type ReadingState } from "@paper-viewer/core/src/paper-status";

export function ReadingStateSelect({ paperId, state }: { paperId: string; state: ReadingState }) {
  return (
    <form action={`/api/papers/${paperId}/reading-state`} method="post">
      <label className="text-xs font-medium uppercase text-muted" htmlFor="state">Reading state</label>
      <div className="mt-1 flex gap-2">
        <select className="w-full rounded border border-border px-3 py-2" id="state" name="state" defaultValue={state}>
          {readingStates.map((readingState) => (
            <option key={readingState} value={readingState}>
              {readingState}
            </option>
          ))}
        </select>
        <button className="rounded border border-border px-3 py-2 text-sm" type="submit">Save</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 6: Create paper workspace page**

Create `apps/web/app/(dashboard)/papers/[paperId]/page.tsx`:

```tsx
import { prisma } from "@paper-viewer/db/src/client";
import { notFound } from "next/navigation";
import { CommentPanel } from "@/components/comment-panel";
import { PdfViewer } from "@/components/pdf-viewer";
import { ReadingStateSelect } from "@/components/reading-state-select";
import { requireCurrentUser } from "@/lib/auth";

export default async function PaperPage({ params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

  const workspacePaper = await prisma.workspacePaper.findUnique({
    where: {
      workspaceId_paperId: {
        workspaceId: user.workspaceId,
        paperId
      }
    },
    include: {
      paper: {
        include: {
          files: true
        }
      }
    }
  });

  if (!workspacePaper) {
    notFound();
  }

  const [comments, readingState] = await Promise.all([
    prisma.comment.findMany({
      where: {
        workspaceId: user.workspaceId,
        paperId
      },
      include: {
        author: true
      },
      orderBy: {
        createdAt: "asc"
      }
    }),
    prisma.readingStateRecord.findUnique({
      where: {
        workspaceId_paperId_userId: {
          workspaceId: user.workspaceId,
          paperId,
          userId: user.id
        }
      }
    })
  ]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-6">
      <section>
        <div className="mb-4 rounded border border-border bg-white p-4">
          <h1 className="text-xl font-semibold">{workspacePaper.paper.title}</h1>
          <p className="mt-2 text-sm text-muted">
            {Array.isArray(workspacePaper.paper.authors) ? workspacePaper.paper.authors.join(", ") : ""}
          </p>
        </div>
        <PdfViewer paperId={paperId} />
      </section>
      <aside className="grid content-start gap-4">
        <div className="rounded border border-border bg-white p-4">
          <ReadingStateSelect paperId={paperId} state={readingState?.state ?? "new"} />
        </div>
        <CommentPanel paperId={paperId} comments={comments} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 7: Run build**

Run:

```bash
pnpm build
```

Expected: app builds successfully.

- [ ] **Step 8: Commit paper workspace**

Run:

```bash
git add apps/web/app/api/papers apps/web/app/\(dashboard\)/papers apps/web/components
git commit -m "feat: add paper workspace collaboration"
```

---

### Task 8: Add Phase 1 End-to-End Test and Final Verification

**Files:**

- Create: `apps/web/tests/paper-workspace.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Add E2E test for core screen availability**

Create `apps/web/tests/paper-workspace.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("library redirects unauthenticated users to login", async ({ page }) => {
  await page.goto("/library");
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 2: Update README with verification commands**

Append this section to `README.md`:

```md
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
```

- [ ] **Step 3: Run full verification**

Run:

```bash
pnpm build
pnpm test
pnpm test:e2e
```

Expected:

- TypeScript build passes.
- Unit tests pass.
- Browser smoke tests pass.

- [ ] **Step 4: Manual smoke test**

Run:

```bash
docker compose up -d
pnpm dev
```

Open `http://localhost:3000/bootstrap` and complete the manual Phase 1 smoke test from the README.

Expected:

- Owner bootstrap works.
- Login session is created.
- PDF upload stores a file in MinIO.
- Library lists the uploaded paper.
- Paper workspace serves the PDF through the authenticated route.
- Comment creation works.
- Reading state update works.

- [ ] **Step 5: Commit test and docs**

Run:

```bash
git add apps/web/tests README.md
git commit -m "test: add phase 1 workspace smoke coverage"
```

---

## Self-Review Checklist

Spec coverage:

- Project scaffold and Docker Compose: Task 1 and Task 2.
- Authentication: Task 4.
- Workspace and membership model: Task 3 and Task 4.
- Manual PDF upload: Task 5 and Task 6.
- Object storage integration: Task 2, Task 5, and Task 6.
- Basic PDF viewer: Task 7.
- Comments: Task 7.
- Reading states: Task 3 and Task 7.
- Security defaults for private PDF serving and upload validation: Task 5 and Task 7.
- Testing strategy for Phase 1: Task 3, Task 5, Task 8.

Validation before marking Phase 1 complete:

```bash
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm build
pnpm test
pnpm test:e2e
```

Manual validation:

- Create owner account at `/bootstrap`.
- Upload a public PDF from `/library`.
- Open the paper workspace.
- Confirm PDF display.
- Add a comment.
- Change reading state.
