#!/bin/bash

export PATH=/usr/bin:/sbin:/usr/sbin

echo "Changing zone properties for $ZONENAME"

if [ -z "$ZONE_ZFS_PROPERTY_PREFIX" ]; then
  echo "Missing ZONE_ZFS_PROPERTY_PREFIX environment variable." >&2
  exit 1
fi

if [ -z "$ZONENAME" -o -z "$ZPOOL_NAME" ]; then
  echo "Missing ZONENAME or ZPOOL_NAME" >&2
  exit 1
fi

if [ ! -z "$OWNER_UUID" ]; then
  zfs set "$ZONE_ZFS_PROPERTY_PREFIX:owner_uuid"="$OWNER_UUID" "$ZPOOL_NAME/$ZONENAME"
fi

if [ ! -z "$CHARGE_AFTER" ]; then
  zfs set "$ZONE_ZFS_PROPERTY_PREFIX:charge_after"="$CHARGE_AFTER" "$ZPOOL_NAME/$ZONENAME"
fi

if [ ! -z "$ZONE_TYPE" ]; then
  zfs set "$ZONE_ZFS_PROPERTY_PREFIX:zone_type"="$ZONE_TYPE" "$ZPOOL_NAME/$ZONENAME"
fi

if [ ! -z "$ZONE_PROPERTY_VERSION" ]; then
  zfs set "$ZONE_ZFS_PROPERTY_PREFIX:property_version"="$ZONE_PROPERTY_VERSION" "$ZPOOL_NAME/$ZONENAME"
fi
