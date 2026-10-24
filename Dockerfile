FROM node:20-alpine

# UID/GID that owns the files in /data; match the host user that owns the bind mount.
ARG UID=1000
ARG GID=1000

ENV DATA_DIR=/data \
    TOKEN_PATH=/config/ring-token \
    CRON_SCHEDULE="*/5 * * * *"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY entrypoint.sh fetch.sh /usr/local/bin/

# Replace the image's default "node" user with one matching the host's UID/GID.
RUN deluser --remove-home node && (delgroup node 2>/dev/null || true) \
 && addgroup -g $GID ring && adduser -D -u $UID -G ring ring \
 && mkdir -p /data /config && chown ring:ring /data /config

VOLUME /data /config
CMD ["entrypoint.sh"]
