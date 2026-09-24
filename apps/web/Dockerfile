# Build from the repo root: docker build -f apps/web/Dockerfile .

# Every workspace manifest is copied so `npm ci` can validate the shared lockfile.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# The workspace root holds TypeScript, which the build needs.
RUN npm ci -w @tesla-pool/web --include-workspace-root

FROM deps AS build
# Rewrites to the API are resolved at build time.
ARG API_URL=http://api:4000
ENV API_URL=$API_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.base.json ./
COPY apps/web apps/web
RUN npm run build -w @tesla-pool/web

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
