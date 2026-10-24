#!/bin/sh
# Runs crond (as root, which busybox requires) with the job itself running as
# the unprivileged data owner, and streams the job log to `docker logs`.
set -e
user=ring
log=$DATA_DIR/fetch.log
chown "$user:$user" "$DATA_DIR"
su "$user" -s /bin/sh -c "touch $log"

# crond doesn't pass the container's environment to jobs, so put it on the line.
# Overwrite rather than append so a container restart doesn't duplicate the entry.
env="PATH=$PATH DATA_DIR=$DATA_DIR BACKFILL_DAYS=${BACKFILL_DAYS:-7} RECHECK_HOURS=${RECHECK_HOURS:-24}"
mkdir -p /etc/crontabs
echo "$CRON_SCHEDULE env $env /usr/local/bin/fetch.sh" > "/etc/crontabs/$user"
rm -f /etc/crontabs/root

echo "ring-events: schedule '$CRON_SCHEDULE' as $user"
crond -b -L /dev/null
exec tail -n 0 -F "$log"
