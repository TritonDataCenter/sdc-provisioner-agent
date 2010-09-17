echo "Live-reiszing zone $ZONENAME"

set -e

if [ -z "$ZONENAME" ]; then
  echo "ZONENAME environment variable must be set" >&2
  exit 1
fi

# memory
# locked-memory
if [ ! -z "$RAM_IN_BYTES" ]; then
  /usr/sbin/rcapadm -z "$ZONENAME" -m "$RAM_IN_BYTES"
  /usr/bin/prctl -n zone.max-locked-memory -v "$RAM_IN_BYTES" -r -i zone "$ZONENAME"
fi

# swap
if [ ! -z "$SWAP_IN_BYTES" ]; then
  /usr/bin/prctl -n zone.max-swap -v "$SWAP_IN_BYTES" -r -i zone "$ZONENAME"
fi

# cpu shares
if [ ! -z "$CPU_SHARES" ]; then
  /usr/bin/prctl -n zone.cpu-shares -v "$CPU_SHARES" -r -i zone "$ZONENAME"
fi

# cpu cap
if [ ! -z "$CPU_CAP" ]; then
  /usr/bin/prctl -n zone.cpu-cap -v "$CPU_CAP" -r -i zone "$ZONENAME"
fi

# max processes
if [ ! -z "$LIGHTWEIGHT_PROCESSES" ]; then
  /usr/bin/prctl -n zone.max-lwps -v "$LIGHTWEIGHT_PROCESSES" -r -i zone "$ZONENAME"
fi

# change quota
if [ ! -z "$DISK_IN_GIGABYTES" ]; then
  /usr/sbin/zfs set quota="$DISK_IN_GIGABYTES" "$ZPOOL_NAME/$ZONENAME"
fi
