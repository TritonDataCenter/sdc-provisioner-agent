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

source /lib/sdc/config.sh
load_sdc_sysinfo

ZONE_ROOT=/$ZPOOL_NAME/$ZONENAME/root

# Check if dataset exists.
if zfs list "$ZPOOL_NAME/$ZONENAME" 2>/dev/null 1>&2; then
  echo "Dataset for $ZONENAME exists." >&2;
  exit 1
fi

# Check if snapshot exists.
if zfs list "$ZPOOL_NAME/$ZONE_TEMPLATE@$ZONENAME" 2>/dev/null 1>&2; then
  echo "Snapshot for $ZONENAME exists." >&2;
  exit 1
fi

# Instatiate the zone from its XML manifest file.
zonecfg -z $ZONENAME create -X

if [ ! -z "$UUID" ]; then
  UUID_PARAM="-U $UUID"
fi

# Install the zone now.
zoneadm -z $ZONENAME install -q ${DISK_IN_GIGABYTES} -t ${ZONE_TEMPLATE} $UUID_PARAM

# Set the hostname.
echo "$HOSTNAME" > "$ZONE_ROOT/etc/nodename"

if [ ! -z "$PUBLIC_IP" ];
then
  eval "PUBLIC_LINK=\${SYSINFO_NIC_${PUBLIC_NIC}}"
  if [ -z "$PUBLIC_LINK" ] ; then
    echo "Public IP requested, but nic \"${PUBLIC_NIC}\" does not exist in sysinfo." >&2;
    exit 1
  fi
fi

if [ ! -z "$PRIVATE_IP" ];
then
  eval "PRIVATE_LINK=\${SYSINFO_NIC_${PRIVATE_NIC}}"
  echo "PRIVATE_LINK=${PRIVATE_LINK}"
  if [ -z "$PRIVATE_LINK" ] ; then
    echo "Public IP requested, but nic \"${PRIVATE_NIC}\" does not exist in sysinfo." >&2;
    exit 1
  fi
fi

# network

if [ ! -z "$PUBLIC_IP" ];
then
  PUBLIC_BLOCKED_PORTS_OPT=""
  if [ ! -z "$PUBLIC_BLOCKED_OUTGOING_PORTS" ] ; then
    PUBLIC_BLOCKED_PORTS_OPT="add property (name=blocked-outgoing-ports, value=\"$PUBLIC_BLOCKED_OUTGOING_PORTS\");"
  fi
  # Set the network settings
  /usr/sbin/zonecfg -z $ZONENAME "select net physical=${PUBLIC_INTERFACE}; set mac-addr=${PUBLIC_MAC}; set vlan-id=${PUBLIC_VLAN_ID}; set global-nic=${PUBLIC_NIC}; ${PUBLIC_BLOCKED_PORTS_OPT} end; exit"

  echo "$PUBLIC_IP netmask $PUBLIC_NETMASK up" > $ZONE_ROOT/etc/hostname.${PUBLIC_INTERFACE}
fi


if [ ! -z "$PRIVATE_IP" ];
then
  PRIVATE_BLOCKED_PORTS_OPT=""
  if [ ! -z "$PRIVATE_BLOCKED_OUTGOING_PORTS" ] ; then
    PRIVATE_BLOCKED_PORTS_OPT="add property (name=blocked-outgoing-ports, value=\"$PRIVATE_BLOCKED_OUTGOING_PORTS\");"
  fi
  # Set the network settings
  /usr/sbin/zonecfg -z $ZONENAME "select net physical=${PRIVATE_INTERFACE}; set mac-addr=${PRIVATE_MAC}; set vlan-id=${PRIVATE_VLAN_ID}; set global-nic=${PRIVATE_NIC}; ${PRIVATE_BLOCKED_PORTS_OPT} end; exit"

  echo "$PRIVATE_IP netmask $PRIVATE_NETMASK up" > $ZONE_ROOT/etc/hostname.${PRIVATE_INTERFACE}
fi

if [ ! -z "$DEFAULT_GATEWAY" ];
then
  echo "$DEFAULT_GATEWAY" > $ZONE_ROOT/etc/defaultrouter
fi

# Write the config settings to zoneconfig where the zone will be able to read
# them.
cat << __EOF__ | cat > $ZONE_ROOT/root/zoneconfig
$ZONECONFIG
__EOF__

# touch log file path so we can start tailing immediately
cat /dev/null > $ZONE_ROOT/var/svc/log/system-zoneinit:default.log

# Remove once zoneinit does this for us
cat > ${ZONE_ROOT}/root/zoneinit.d/01-reboot-file.sh <<EOF
if [[ ! -f /tmp/.FIRST_REBOOT_NOT_YET_COMPLETE ]]; then
    touch /tmp/.FIRST_REBOOT_NOT_YET_COMPLETE
fi
EOF

# Add zone metadata
source $DIR/zone_properties.sh

/usr/sbin/zoneadm -z $ZONENAME boot
