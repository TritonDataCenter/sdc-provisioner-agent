#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2014, Joyent, Inc.
#

export PATH=/usr/bin:/sbin:/usr/sbin

echo "Changing zone properties for $ZONENAME"

zone_property() {
  PROP_NAME=$1
  PROP_VALUE=$2
  
  # Remove attr if it exists already.
  zonecfg -z "$ZONENAME" "remove attr name=${PROP_NAME}; commit" >/dev/null 2>&1 || true

  # Add or re-add attr
  zonecfg -z "$ZONENAME" "add attr; set name=\"${PROP_NAME}\"; set type=string; set value=\"${PROP_VALUE}\"; end; commit"
}

if [ -z "$ZONENAME" -o -z "$ZPOOL_NAME" ]; then
  echo "Missing ZONENAME or ZPOOL_NAME" >&2
  exit 1
fi

if [ ! -z "$OWNER_UUID" ]; then
  zone_property owner-uuid "$OWNER_UUID"
fi

if [ ! -z "$CHARGE_AFTER" ]; then
  zone_property charge-after "$CHARGE_AFTER"
fi

if [ ! -z "$ZONE_TYPE" ]; then
  zone_property zone-type "$ZONE_TYPE"
fi

if [ ! -z "$ZONE_PROPERTY_VERSION" ]; then
  zone_property property-version "$ZONE_PROPERTY_VERSION"
fi
