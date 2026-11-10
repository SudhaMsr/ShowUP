FROM node:20-alpine
WORKDIR /app
COPY server/ ./server/
ENV PORT=8787 RELAY_DATA=/data
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "server/relay.mjs"]
