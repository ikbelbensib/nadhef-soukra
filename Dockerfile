# syntax=docker/dockerfile:1

# ---- Étape 1 : dépendances -------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json  shared/
COPY server/package.json  server/
COPY client/package.json  client/
RUN npm ci

# ---- Étape 2 : build -------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=deps /app/client/node_modules ./client/node_modules
COPY . .
RUN npm run build

# ---- Étape 3 : exécution ---------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace @nadhef/server --include-workspace-root

COPY --from=build /app/shared/dist  ./shared/dist
COPY --from=build /app/server/dist  ./server/dist
COPY --from=build /app/client/dist  ./client/dist
# Frontières OSM : chargées en mémoire au boot, le serveur ne démarre pas sans.
# Les migrations sont déjà dans dist/ (voir server/scripts/copy-migrations.mjs).
COPY --from=build /app/server/data ./server/data

# La base SQLite locale vit dans un volume — jamais dans la couche d'image.
RUN mkdir -p /app/server/data/db && chown -R node:node /app/server/data
USER node

ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/server
CMD ["node", "dist/index.js"]
