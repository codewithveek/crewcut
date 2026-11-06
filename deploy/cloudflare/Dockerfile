# Crewcut in one container: the studio (web app + agent) and its render
# worker, which it starts per job (CREWCUT_RENDER_MODE=spawn). Remotion brings
# its own ffmpeg; Chromium (chrome-headless-shell) is fetched at build time.
# Build context: the repo root (see wrangler.jsonc).
FROM node:24-bookworm-slim

# Chrome headless shell's system libraries, fonts for text in videos.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 \
      libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 \
      fonts-liberation fonts-noto-core fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# pnpm in its own cached layer, retried: slow or flaky links time out on the first try.
RUN corepack enable && for i in 1 2 3 4 5; do corepack prepare pnpm@10.32.1 --activate && break || sleep 10; done && pnpm --version
WORKDIR /app
ENV CI=1 PNPM_HOME=/pnpm

# Dependencies first so code changes don't reinstall them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/studio/package.json apps/studio/
COPY apps/render-worker/package.json apps/render-worker/
COPY packages packages
RUN for i in 1 2 3; do pnpm install --frozen-lockfile --network-concurrency 8 && break || sleep 15; done && test -d node_modules/.pnpm

# Remotion's browser, downloaded once into the image.
RUN cd apps/render-worker && node -e "import('@remotion/renderer').then(r => r.ensureBrowser())"

COPY . .
RUN pnpm install --frozen-lockfile --offline && pnpm --filter @crewcut/studio build

ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 CREWCUT_RENDER_MODE=spawn
EXPOSE 8080
WORKDIR /app/apps/studio
CMD ["node", ".output/server/index.mjs"]
