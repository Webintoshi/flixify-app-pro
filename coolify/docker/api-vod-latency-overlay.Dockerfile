FROM flixify-api:referral-stripe-20260925
ARG SOURCE_COMMIT
LABEL org.opencontainers.image.revision=${SOURCE_COMMIT}

# Patch the running API source so its newer direct-provider path stays intact.
COPY coolify/patches/apply-live-vod-latency.mjs /tmp/apply-live-vod-latency.mjs
WORKDIR /app
RUN node /tmp/apply-live-vod-latency.mjs \
  && npm run build -w @flixify/api
