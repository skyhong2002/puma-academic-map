FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node server/comments.js ./server/
COPY --chown=node:node src/comment-board-id.js ./src/
COPY --chown=node:node data/signatories.json ./data/
RUN install -d -m 700 -o node -g node /data
USER node
ENV COMMENTS_HOST=0.0.0.0 COMMENTS_DATA_DIR=/data
VOLUME ["/data"]
CMD ["node", "server/comments.js"]
