#!/bin/bash

export PATH=/usr/bin:/sbin:/usr/sbin

echo "Deactivating zone $ZONENAME"

if [ -z "$ZONE_ZFS_PROPERTY_PREFIX" ]; then
  echo "Missing ZONE_ZFS_PROPERTY_PREFIX environment variable." >&2
  exit 1
fi

if [ -z "$ZONENAME" ]; then
  echo "ZONENAME environment variable must be set" >&2
  exit 1
fi

if [ ! -z "$DELETED_AT" ]; then
  if [ -z "$ZPOOL_NAME" ]; then
    echo "Missing ZONENAME or ZPOOL_NAME" >&2
    exit 1
  fi
  zfs set "$ZONE_ZFS_PROPERTY_PREFIX:deleted_at"="$DELETED_AT" "$ZPOOL_NAME/$ZONENAME"
fi

# deactivate
zonecfg -z "$ZONENAME" set autoboot=false
zoneadm -z "$ZONENAME" halt
