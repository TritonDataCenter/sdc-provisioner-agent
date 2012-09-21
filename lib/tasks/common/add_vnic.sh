#!/bin/bash

# This script adds a vnic to the given zone

set -e
set -o xtrace

PATH=/usr/bin:/sbin:/usr/sbin
DIR=`dirname $0`

export PATH

# Check arguments
NEEDED_ARGS=(
  NIC \
  INTERFACE \
  MAC \
  VLAN_ID \
  ZONENAME \
  ZPOOL_NAME \
  NETMASK \
  IP \
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

GATEWAY_PROP=""
if [ ! -z "$GATEWAY" ] ; then
  GATEWAY_PROP="add property (name=gateway, value=\"$GATEWAY\");"
fi

INDEX=${INTERFACE#net}

# Add network settings to the vnic
/usr/sbin/zonecfg -z $ZONENAME "select net physical=${INTERFACE}; \
  set mac-addr=${MAC}; \
  set vlan-id=${VLAN_ID}; \
  set global-nic=${NIC}; \
  add property (name=index, value=\"$INDEX\"); \
  add property (name=ip, value=\"$IP\"); \
  add property (name=netmask, value=\"$NETMASK\"); \
  ${GATEWAY_PROP} \
  ${BLOCKED_PORTS_OPT} \
  end; exit"

echo "$IP netmask $NETMASK up" > $ZONE_ROOT/etc/hostname.${INTERFACE}

echo "Successfully added interface ${INTERFACE} to zone ${ZONENAME}"
