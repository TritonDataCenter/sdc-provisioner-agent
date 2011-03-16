#!/bin/bash

# This script is responsible for the zone configuration that needs to happen
# at the global zone level. The provisioner agent sets up the zone's xml
# file and then calls this script. At that point, the provisiner agent will
# continue handling AMQP requests, while this script "runs in the background"
# and eventually boots the new zone.

set -e
set -o xtrace

PATH=/usr/bin:/sbin:/usr/sbin
DIR=`dirname $0`

export PATH

# Check arguments
NEEDED_ARGS=(
  "NIC=${NIC}" \
  "INTERFACE=${INTERFACE}" \
  "MAC=${MAC}" \
  "VLAN_ID=${VLAN_ID}" \
  "ZONENAME=${ZONENAME}" \
  "NETMASK=${NETMASK}" \
  "IP=${IP}" \
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

# Only add vnics to halted zones (the true is so we don't bail due to -e)
ZONE_RUNNING=$(/usr/sbin/zoneadm list | grep "${ZONENAME}" || true)
if [ -n "${ZONE_RUNNING}"  ] ; then
  echo "Zone ${ZONENAME} is running.  Will only add vnics to halted zones."
  exit 1
fi

# Load env vars from sysinfo with SYSINFO_ prefix
source /lib/sdc/config.sh
load_sdc_sysinfo

eval "LINK=\${SYSINFO_NIC_${NIC}}"
if [ -z "$LINK" ] ; then
  echo "Public IP requested, but nic \"${NIC}\" does not exist in sysinfo." >&2;
  exit 1
fi

# Bail if this is a duplicate nic name
PHYS_LINE=$(/usr/sbin/zonecfg -z $ZONENAME info net | grep "physical: ${INTERFACE}" || true)
if [ -n "${PHYS_LINE}" ] ; then
  echo "Zone '${ZONENAME}' already has a vnic named '${INTERFACE}'"
  exit 1
fi

# Add the vnic to the zone
/usr/sbin/zonecfg -z $ZONENAME "add net; set physical=${INTERFACE}; end; exit"

BLOCKED_PORTS_OPT=""
if [ ! -z "$BLOCKED_OUTGOING_PORTS" ] ; then
  BLOCKED_PORTS_OPT="add property (name=blocked-outgoing-ports, value=\"$BLOCKED_OUTGOING_PORTS\");"
fi

# Add network settings to the vnic
/usr/sbin/zonecfg -z $ZONENAME "select net physical=${INTERFACE}; set mac-addr=${MAC}; set vlan-id=${VLAN_ID}; set global-nic=${NIC}; ${BLOCKED_PORTS_OPT} end; exit"

echo "$IP netmask $NETMASK up" > $ZONE_ROOT/etc/hostname.${INTERFACE}

