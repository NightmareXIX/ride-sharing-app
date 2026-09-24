# Build from the repo root: docker build -f apps/api/Dockerfile .

# Every workspace manifest is copied so `npm ci` can validate the shared lockfile.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# The workspace root holds TypeScript, which the build needs.
RUN npm ci -w @tesla-pool/api --include-workspace-root

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN npm run build -w @tesla-pool/api

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @tesla-pool/api --omit=dev && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/drizzle apps/api/drizzle

WORKDIR /app/apps/api
USER node
EXPOSE 4000
# Migrate, seed (idempotent), then hand PID 1's signals to the server via exec (NFR-16, NFR-31).
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && exec node dist/server.js"]
