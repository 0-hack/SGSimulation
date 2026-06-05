# ---- Build stage: install production deps (compiles better-sqlite3) ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Build tools in case better-sqlite3 needs to compile from source.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install only production dependencies (skips puppeteer/dev tooling).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Runtime stage: slim image with just the app + node_modules ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public

# Persisted SQLite database lives here; mount a volume to keep saves.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000

# Lightweight container health check hitting the API.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
