FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/worker ./apps/worker
COPY packages/core ./packages/core
COPY packages/runtime ./packages/runtime
RUN pnpm install --frozen-lockfile && pnpm --filter @conciliacao/core build && pnpm --filter @conciliacao/runtime build && pnpm --filter @conciliacao/worker build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends clamav poppler-utils tesseract-ocr tesseract-ocr-por && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app app
COPY --from=build --chown=app:app /app ./
USER app
CMD ["node", "apps/worker/dist/main.js"]
