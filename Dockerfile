FROM node:22-alpine

WORKDIR /app
COPY package.json yarn.lock ./
RUN corepack enable && corepack prepare yarn@1.22.11 --activate && yarn install --frozen-lockfile --production && mkdir -p /app/data && chown node:node /app/data
COPY --chown=node:node server.js participants.json ./
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts

ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 CMD node --input-type=module -e "const response = await fetch('http://127.0.0.1:3000/health'); process.exit(response.ok ? 0 : 1);"
CMD ["node", "server.js"]
