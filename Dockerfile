FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SOURCE_CODE_URL
ARG NEXT_PUBLIC_PLATFORM_AI_MANAGED=true
ENV NEXT_PUBLIC_SELF_HOSTED_MODE=false \
    NEXT_PUBLIC_OPEN_REGISTRATION=true \
    NEXT_PUBLIC_PLATFORM_AI_MANAGED=$NEXT_PUBLIC_PLATFORM_AI_MANAGED \
    NEXT_PUBLIC_SOURCE_CODE_URL=$NEXT_PUBLIC_SOURCE_CODE_URL \
    SHARP_IGNORE_GLOBAL_LIBVIPS=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs \
    && mkdir -p /data/accounts /data/storage \
    && chown -R nextjs:nodejs /data
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
