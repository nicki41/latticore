# Contributing

Thanks for considering a contribution to Latticore.

## Development setup

See [docs/development.md](docs/development.md) for running the panel locally without a full Docker rebuild (npm workspaces, Prisma, running tests).

For a Docker-based dev loop that builds the image from source instead of pulling from GHCR:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Working on the panel-managed Java runtime images (`runtime-images/`)? These are normally published by CI (`.github/workflows/docker-publish.yml`) and pulled automatically — to test a change locally instead, build and tag one to match what the API expects, then point `RUNTIME_IMAGE_BASE` at your local tag:

```bash
docker build -f runtime-images/java21/Dockerfile -t latticore-runtime-local:java21 runtime-images/
# then in .env: RUNTIME_IMAGE_BASE=latticore-runtime-local
```

## Before opening a PR

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

All of these also run in CI (`.github/workflows/ci.yml`) on every pull request.

## Pull requests

- Keep PRs focused — one change per PR is easier to review than several bundled together.
- Explain the *why* in the PR description, not just the *what*.
- Add or update tests for behavior you change.
- Update the relevant page under `docs/` if the change affects configuration, architecture, or operations.
- If the change adds, removes, or visibly reshapes a feature, update [docs/FEATURES.md](docs/FEATURES.md).
- Screenshots of the UI belong in the PR description, not the repository. Take them against a local/demo instance with placeholder data, never a real deployment — the panel shows the host's real public IP next to a server's port (`apps/api/src/lib/publicIp.ts`).

## Reporting bugs / requesting features

Use the issue templates — they ask for the information that's actually needed to act on a report (steps to reproduce, environment, logs).

## Security issues

Do not open a public issue for a security vulnerability — see [SECURITY.md](SECURITY.md).
