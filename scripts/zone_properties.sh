#!/bin/bash

PATH=/usr/bin:/sbin:/usr/sbin
export PATH

if [ -z "$ZONENAME" -o -z "$ZPOOL_NAME" ]; then
  echo "Missing ZONENAME or ZPOOL_NAME" >&2
  exit 1
fi

# set +e
# test ! -z "$CUSTOMER_UUID" && zfs set "com.joyent:customer_uuid"="$CUSTOMER_UUID" "$ZPOOL_NAME/$ZONENAME"
if [ ! -z "$CUSTOMER_UUID" ]; then
  zfs set "com.joyent:customer_uuid"="$CUSTOMER_UUID" "$ZPOOL_NAME/$ZONENAME"
fi

if [ ! -z "$CHARGE_AFTER" ]; then
  zfs set "com.joyent:charge_after"="$CHARGE_AFTER" "$ZPOOL_NAME/$ZONENAME"
fi

if [ ! -z "$ZONE_TYPE" ]; then
  zfs set "com.joyent:zone_type"="$ZONE_TYPE" "$ZPOOL_NAME/$ZONENAME"
fi

# set -e
