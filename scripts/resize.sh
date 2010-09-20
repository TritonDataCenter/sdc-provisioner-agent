#!/bin/bash

echo "Live-resizing zone $ZONENAME"

set -e

if [ -z "$ZONENAME" ]; then
  echo "ZONENAME environment variable must be set" >&2
  exit 1
fi

set_resource_control() {
  ZONENAME=$1
  RESOURCE=$2
  VALUE=$3

  # change the live value
  /usr/bin/prctl -n $RESOURCE -v "$VALUE" -r -i zone "$ZONENAME"

  # write the change out to the zone xml file
  /usr/sbin/zonecfg -z "$ZONENAME" << __EOF__
  remove rctl name=$RESOURCE
  add rctl
  set name=$RESOURCE
  add value (priv=privileged,limit=${VALUE},action=deny)
  end
  commit
__EOF__
}

# memory
# locked-memory
if [ ! -z "$RAM_IN_BYTES" ]; then
  /usr/sbin/rcapadm -z "$ZONENAME" -m "$RAM_IN_BYTES"

  set_resource_control $ZONENAME zone.max-locked-memory $RAM_IN_BYTES
fi

# swap
if [ ! -z "$SWAP_IN_BYTES" ]; then
  set_resource_control $ZONENAME zone.max-swap $SWAP_IN_BYTES
fi

# cpu shares
if [ ! -z "$CPU_SHARES" ]; then
  set_resource_control $ZONENAME zone.cpu-shares $CPU_SHARES
fi

# cpu cap
if [ ! -z "$CPU_CAP" ]; then
  set_resource_control $ZONENAME zone.cpu-cap $CPU_CAP
fi

# max processes
if [ ! -z "$LIGHTWEIGHT_PROCESSES" ]; then
  set_resource_control $ZONENAME zone.max-lwps $LIGHTWEIGHT_PROCESSES
fi

# change quota
if [ ! -z "$DISK_IN_GIGABYTES" ]; then
  /usr/sbin/zfs set quota="$DISK_IN_GIGABYTES" "$ZPOOL_NAME/$ZONENAME"
fi
