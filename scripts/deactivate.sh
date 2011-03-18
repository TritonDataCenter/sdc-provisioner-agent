#!/bin/bash

export PATH=/usr/bin:/sbin:/usr/sbin

echo "Deactivating zone $ZONENAME"

if [ -z "$ZONENAME" ]; then
  echo "ZONENAME environment variable must be set" >&2
  exit 1
fi

# Set the "deleted-at" zone property
if [ ! -z "$DELETED_AT" ]; then
  zonecfg -z "$ZONENAME" "add attr; set name=\"deleted-at\"; set type=string; set value=\"${DELETED_AT}\"; end; commit"
fi

# deactivate
zonecfg -z "$ZONENAME" set autoboot=false
zoneadm -z "$ZONENAME" halt -X
