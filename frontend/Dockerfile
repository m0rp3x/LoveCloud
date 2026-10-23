ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=1536
COPY --from=dependencies /app/node_modules ./node_modules
COPY frontend/ .
RUN npm run build && \
    rm -rf /app/.next/standalone/node_modules/sharp /app/.next/standalone/node_modules/@img && \
    test -z "$(find /app/.next/standalone -name '*vips*' -o -path '*/node_modules/sharp')"
FROM ${NODE_IMAGE} AS runtime
ARG VERSION=0.1.0
ARG REVISION=development
LABEL org.opencontainers.image.title="LoveCloud frontend" \
      org.opencontainers.image.source="https://github.com/m0rp3x/LoveCloud" \
      org.opencontainers.image.revision=${REVISION} \
      org.opencontainers.image.version=${VERSION} \
      org.opencontainers.image.licenses="Apache-2.0"
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# Optional optimizer packages were pruned BEFORE COPY, so no final layer ships them.
COPY LICENSE NOTICE THIRD_PARTY_NOTICES /usr/share/licenses/lovecloud/
COPY licenses/ /usr/share/licenses/lovecloud/licenses/
USER nextjs
EXPOSE 3000
CMD ["node","server.js"]
