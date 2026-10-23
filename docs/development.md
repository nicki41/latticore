# Development setup

For local development without a full Docker rebuild on every change.

**Prerequisites**: Node.js ≥ 22 (the Docker image and CI use 24 LTS), npm, and a local Docker daemon (needed for the Minecraft container-management features). No separate database to install — SQLite runs embedded.

```bash
npm install
cp .env.example .env
echo 'DATABASE_URL=file:./prisma/dev.db' >> .env   # local dev only, see the .env comment
npm run prisma:migrate -w apps/api
npm run dev
```

`npm run dev` starts `packages/shared` in watch mode, the API (`tsx watch`), and the Vite frontend dev server, all in parallel. The frontend runs on its own Vite port and proxies API requests to the locally running API.

**Testing Minecraft server creation locally**: `HOST_DATA_PATH`'s normal auto-detection (see [docs/configuration.md](configuration.md#host_data_path-the-sibling-container-problem)) only works when the API itself is running *as* a Docker container — it self-inspects its own mounts. Running the API directly via `npm run dev` instead, you're not a container at all, so set `HOST_DATA_PATH` explicitly in `.env` to the absolute path of this repo's `data/` folder before exercising anything that creates a real Minecraft server container.

## Scripts

Run from the repo root — these operate across all workspaces:

| Command | Purpose |
|---|---|
| `npm run typecheck` | TypeScript check across all workspaces (builds `packages/shared` first) |
| `npm run test` | All Vitest suites (shared, api, web) |
| `npm run test:api` | API test suite only |
| `npm run build` | Production build, all workspaces |
| `npm run lint` | ESLint (flat config in `eslint.config.mjs`: typescript-eslint recommended + React hooks rules) across all workspaces |
| `npm run prisma:studio` | Prisma Studio, for inspecting the database |

Tests run completely without a real database or Docker daemon — Prisma and Docker calls are replaced with fakes/mocks in the relevant unit tests. See `apps/api/src/**/*.test.ts`.

To run a single test file or a single test case with Vitest:

```bash
npm run test -w apps/api -- src/modules/roles/roles.service.test.ts
npm run test -w apps/api -- src/modules/roles/roles.service.test.ts -t "test name"
```
