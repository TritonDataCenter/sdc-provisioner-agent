#!/bin/bash

# This script removes a vnic from the given zone

set -e
set -o xtrace

PATH=/usr/bin:/sbin:/usr/sbin
DIR=`dirname $0`

export PATH

# Check arguments
NEEDED_ARGS=(
  INTERFACE \
  ZONENAME \
  ZPOOL_NAME \
)

for input in ${NEEDED_ARGS[@]}; do
  eval "testval=\${${input}}"
  if [ -z "$testval" ]; then
    echo "Must specify '${input}' in the environment!"
    exit 1
  fi
  eval "${input}=${testval}"
done

ZONE_ROOT=/$ZPOOL_NAME/$ZONENAME/root

# Only remove vnics from halted zones (the true is so we don't bail due to -e)
ZONE_RUNNING=$(/usr/sbin/zoneadm list | grep "${ZONENAME}" || true)
if [ -n "${ZONE_RUNNING}"  ] ; then
  echo "Zone ${ZONENAME} is running.  Will only add vnics to halted zones."
  exit 1
fi

# Remove the vnic from the zone (if it exists)
NIC_EXISTS=$(/usr/sbin/zonecfg -z $ZONENAME "info net physical=${INTERFACE}")
if [ "${NIC_EXISTS}" != "No such net resource." ]; then
  /usr/sbin/zonecfg -z $ZONENAME "remove net physical=${INTERFACE}"
else
  echo "Zone ${ZONENAME} does not have a nic named '${INTERFACE}'"
fi

HOSTNAME_FILE=$ZONE_ROOT/etc/hostname.${INTERFACE}
if [ -e $HOSTNAME_FILE ]; then
  rm $HOSTNAME_FILE
fi

echo "Successfully removed interface ${INTERFACE} from zone ${ZONENAME}"

