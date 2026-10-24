# ring-events

A container that archives Ring camera events. On a cron schedule (every 5 minutes by default) it pulls new motion and doorbell (ding) events from every camera on the account and saves:

    data/<camera>/<YYYY-MM-DD>/<HHMMSS>-<kind>-<ding_id>.json   event metadata (times are UTC)
    data/<camera>/<YYYY-MM-DD>/<HHMMSS>-<kind>-<ding_id>.mp4    the clip (needs Ring Protect)

`video.status` in each JSON file is `stored`, `pending` (retried on later runs) or `unavailable`.

Built on [ring-client-api](https://github.com/dgreif/ring).

## Setup

1. Clone and say which host user should own the data:

       git clone https://github.com/koyli/ring-events && cd ring-events
       printf 'UID=%s\nGID=%s\n' "$(id -u)" "$(id -g)" > .env

   Optionally set `DATA_PATH` (where events go) and `CONFIG_PATH` (where the Ring token goes) in `.env`. Keep `CONFIG_PATH` outside `DATA_PATH` so anything that reads the archive can't see your Ring login.

2. Build and start:

       docker-compose up -d --build

3. Get a refresh token just for this container (prompts for your Ring email, password and 2FA code):

       docker-compose exec -u ring ring-events npx ring-auth-cli

4. Save the token it prints, without leaving it in shell history:

       read -rs T && printf %s "$T" > config/ring-token && chmod 600 config/ring-token; unset T

The next scheduled run picks it up. Ring rotates the token on each use and the container saves the new one, so don't share it with other Ring tools.

## Operating

- Logs: `docker logs -f ring-events` (also `data/fetch.log`)
- Run now: `docker-compose exec -u ring ring-events fetch.sh`
- Update: `git pull && docker-compose up -d --build`

Settings (in `.env`): `CRON_SCHEDULE` (default `*/5 * * * *`), `BACKFILL_DAYS` (events older than this are ignored; also how far back the first run goes, default 7), `RECHECK_HOURS` (how long to retry clips that aren't ready, default 24), `DATA_PATH` (archive folder, default `./data`), `CONFIG_PATH` (token folder, default `./config`), `EVENT_KINDS` (comma-separated Ring event kinds to keep, default `motion,ding`; others include `on_demand`, `on_demand_link`, `alarm`).
