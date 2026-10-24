#!/bin/sh
# One cron run. flock stops overlapping runs when big clips take longer than the interval.
log=${DATA_DIR:-/data}/fetch.log

# Keep the log from growing forever.
[ -f "$log" ] && [ "$(stat -c %s "$log")" -gt 5000000 ] && mv "$log" "$log.1"

cd /app && exec flock -n /tmp/ring-events.lock node src/fetch-events.mjs >> "$log" 2>&1
