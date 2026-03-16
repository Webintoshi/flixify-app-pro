FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY scripts ./scripts
COPY apps ./apps
COPY packages ./packages

RUN npm ci
RUN npm run build -w @flixify/contracts \
  && npm run build -w @flixify/sdk \
  && npm run build -w @flixify/api

ENV NODE_ENV=production
ENV API_PORT=4000

EXPOSE 4000

CMD ["npm", "run", "start", "-w", "@flixify/api"]
