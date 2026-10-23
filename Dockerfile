# syntax=docker/dockerfile:1

########################################
# Base: install the full workspace once (kept for both build and runtime —
# simpler and more robust than maintaining a separate prod-only install,
# and prisma's CLI needs to be present at runtime to run migrations anyway)
########################################
FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

########################################
# Build: compile shared -> api -> web
########################################
FROM base AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build -w packages/shared
RUN npm run -w apps/api prisma:generate
RUN npm run build -w apps/api
RUN npm run build -w apps/web

########################################
# Runtime image
########################################
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOME=/app
WORKDIR /app
# node:24-bookworm-slim already ships a "node" user/group at a fixed
# 1000:1000 — reused as-is instead of creating a new one (groupadd -g 1000
# fails outright because that gid is already taken). Conveniently, 1000 is
# also the first regular-user uid on most Linux hosts, so the host ./data
# bind mount can still be given matching ownership predictably — see README
# "Permissions" if you hit EACCES errors on first run.
# gosu: lets entrypoint.sh start as root (needed to grant "node" access to
# the host's Docker-socket group, whose gid isn't known until runtime — see
# entrypoint.sh) and then drop to "node" for everything it actually runs,
# so the app process itself never runs as root.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini gosu tzdata && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data && chown -R node:node /app /data

# From "build", not "base": prisma generate (which runs in the build stage)
# writes the generated client into node_modules/.prisma — "base"'s
# node_modules predates that step and would boot with an uninitialized
# @prisma/client.
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/web/dist apps/web/dist
COPY docker/entrypoint.sh entrypoint.sh
RUN chmod +x entrypoint.sh

# No USER directive: the container starts as root so entrypoint.sh can grant
# "node" access to the host's Docker-socket group, then immediately drops
# to "node" (via gosu) for migrations and the actual app process — see
# entrypoint.sh for why that gid can't be known at image build time.
EXPOSE 3000
VOLUME ["/data"]

ENTRYPOINT ["tini", "--", "./entrypoint.sh"]
CMD ["node", "apps/api/dist/server.js"]
