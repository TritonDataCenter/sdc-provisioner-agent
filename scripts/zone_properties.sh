#!/bin/bash

PATH=/usr/bin:/sbin:/usr/sbin
export PATH

if [ -z "$ZONENAME" -o -z "$ZPOOL_NAME" ]; then
  echo "Missing ZONENAME or ZPOOL_NAME" >&2
  exit 1
fi

test ! -z "$CUSTOMER_UUID" && zfs set "com.joyent:customer_uuid"="$CUSTOMER_UUID" "$ZPOOL_NAME/$ZONENAME"
test ! -z "$CHARGE_AFTER"  && zfs set "com.joyent:charge_after"="$CHARGE_AFTER" "$ZPOOL_NAME/$ZONENAME"
test ! -z "$ZONE_TYPE"     && zfs set "com.joyent:zone_type"="$ZONE_TYPE" "$ZPOOL_NAME/$ZONENAME"
