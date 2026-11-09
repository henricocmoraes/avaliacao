FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 REQUIRE_AUTH=1
WORKDIR /app
COPY server.mjs ./server.mjs
COPY public ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4173
CMD ["node", "server.mjs"]
