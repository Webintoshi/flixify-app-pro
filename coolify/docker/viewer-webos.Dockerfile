FROM node:22-alpine

WORKDIR /app

ARG VITE_API_BASE_URL
ARG VITE_APP_DEMO_MODE=false

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_APP_DEMO_MODE=${VITE_APP_DEMO_MODE}

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY scripts ./scripts
COPY apps ./apps
COPY packages ./packages

RUN npm ci \
  --include-workspace-root \
  --workspace @flixify/contracts \
  --workspace @flixify/sdk \
  --workspace @flixify/viewer-core \
  --workspace @flixify/viewer-webos \
  --no-audit \
  --fund=false
RUN npm run build -w @flixify/contracts \
  && npm run build -w @flixify/sdk \
  && npm run build -w @flixify/viewer-core \
  && npm run build -w @flixify/viewer-webos

ENV NODE_ENV=production
ENV VIEWER_WEBOS_PORT=4173

EXPOSE 4173

CMD ["npm", "run", "preview", "-w", "@flixify/viewer-webos", "--", "--host", "0.0.0.0", "--port", "4173"]
