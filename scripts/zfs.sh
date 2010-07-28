#!/bin/bash

set -e
/sbin/zfs snapshot "$ZPOOL_NAME/$ZONE_TEMPLATE@$ZONENAME"
/sbin/zfs clone "$ZPOOL_NAME/$ZONE_TEMPLATE@$ZONENAME" "$ZPOOL_NAME/$ZONENAME"
/sbin/zfs set "quota=${DISK_IN_GIGABYTES}g" "$ZPOOL_NAME/$ZONENAME"
