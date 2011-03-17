#!/bin/bash

# This script removes a vnic from the given zone

set -e
set -o xtrace

PATH=/usr/bin:/sbin:/usr/sbin
DIR=`dirname $0`

export PATH

# Check arguments
NEEDED_ARGS=(
  "INTERFACE=${INTERFACE}" \
  "ZONENAME=${ZONENAME}" \
  "ZONE_ROOT=${ZONE_ROOT}" \
)

for input in ${NEEDED_ARGS[@]}; do
  fields=(${input//=/ })
  desc=${fields[0]}
  value=${fields[1]}
  if [ -z "$value" ]; then
    echo "Must specify '${desc}' in the environment!"
    exit 1
  fi
done

# Only remove vnics from halted zones (the true is so we don't bail due to -e)
ZONE_RUNNING=$(/usr/sbin/zoneadm list | grep "${ZONENAME}" || true)
if [ -n "${ZONE_RUNNING}"  ] ; then
  echo "Zone ${ZONENAME} is running.  Will only add vnics to halted zones."
  exit 1
fi

# Remove the vnic from the zone
/usr/sbin/zonecfg -z $ZONENAME "remove net physical=${INTERFACE}"

HOSTNAME_FILE=$ZONE_ROOT/etc/hostname.${INTERFACE}
if [ -e $HOSTNAME_FILE ]; then
    rm $HOSTNAME_FILE
fi

echo "Successfully removed interface ${INTERFACE} from zone ${ZONENAME}"

