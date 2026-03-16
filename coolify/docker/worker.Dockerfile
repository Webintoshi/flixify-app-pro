FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY scripts ./scripts
COPY apps ./apps
COPY packages ./packages

RUN npm ci
RUN npm run build -w @flixify/contracts \
  && npm run build -w @flixify/worker

ENV NODE_ENV=production

CMD ["npm", "run", "start", "-w", "@flixify/worker"]
