#!/bin/bash

echo "Cleaning up zone $ZONENAME"

if [ -z "$ZONENAME" ];
then
  echo "ZONENAME environment variable must be set" >&2
  exit 1
fi

# deactivate
/usr/sbin/zoneadm -z "$ZONENAME" halt
/usr/sbin/zonecfg -z "$ZONENAME" set autoboot=false

# destroy
/usr/sbin/zoneadm -z "$ZONENAME" uninstall -F
/usr/sbin/zonecfg -z "$ZONENAME" delete -F

exit 0
