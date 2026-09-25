FROM flixify-ops-web:montana-front-b14aefc
ARG SOURCE_COMMIT
LABEL org.opencontainers.image.revision=${SOURCE_COMMIT}

# Keep the running production image's API, contracts, dependencies and download assets.
# Only the web UI source is replaced, then Next.js is rebuilt in that environment.
COPY apps/ops-web/app /app/apps/ops-web/app
COPY apps/ops-web/lib /app/apps/ops-web/lib

WORKDIR /app
RUN npm run build -w @flixify/ops-web
