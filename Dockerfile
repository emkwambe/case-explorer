# syntax=docker/dockerfile:1.7
# Multi-stage image: builds the demo UI, then serves the API (which also serves the built UI).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && node scripts/benchmark.js --count 500 --stratified 40 --out artifacts --no-fail

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/docs/openapi.yaml ./docs/openapi.yaml
COPY --from=build /app/artifacts ./artifacts
COPY --from=build /app/dist ./dist
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "src/server.js"]
