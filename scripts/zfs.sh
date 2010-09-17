#!/bin/bash

set -e

if [ -z "$ZONENAME" ];
then
  echo "ZONENAME environment variable must be set" >&2
  exit 1
fi

/sbin/zfs snapshot "$ZPOOL_NAME/$ZONE_TEMPLATE@$ZONENAME"
/sbin/zfs clone "$ZPOOL_NAME/$ZONE_TEMPLATE@$ZONENAME" "$ZPOOL_NAME/$ZONENAME"
/sbin/zfs set "quota=${DISK_IN_GIGABYTES}g" "$ZPOOL_NAME/$ZONENAME"
