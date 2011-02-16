#!/bin/bash

# This script is responsible for the zone configuration that needs to happen
# at the global zone level. The provisioner agent sets up the zone's xml
# file and then calls this script. At that point, the provisiner agent will
# continue handling AMQP requests, while this script "runs in the background"
# and eventually boots the new zone.

set -e
set -o xtrace

PATH=/usr/bin:/sbin:/usr/sbin
export PATH

# Load env vars from sysinfo with SYSINFO_ prefix or use test values if we are
# passed the NO_SYSINFO env variable.
if [ ! -z "$NO_SYSINFO" ]; then
    PUBLIC_LINK=e1000g0
    PRIVATE_LINK=e1000g2
else
    source /lib/sdc/config.sh
    load_sdc_sysinfo
fi

ZONE_ROOT=/$ZPOOL_NAME/$ZONENAME/root

# --- node
# 0. recv amqp provision command
# 1. Write /etc/zones/zonename.xml

# check if dataset exists
if zfs list "$ZPOOL_NAME/$ZONENAME" 2>/dev/null 1>&2; then
  echo "Dataset for $ZONENAME exists." >&2;
  exit 1
fi

if zfs list "$ZPOOL_NAME/$ZONE_TEMPLATE@$ZONENAME" 2>/dev/null 1>&2; then
  echo "Snapshot for $ZONENAME exists." >&2;
  exit 1
fi

if [ $BASEOS_VERS -lt 147 -o ! -z "$NO_SYSINFO" ]; then
  # pre b147 systems
  #   2. Append to /etc/zones/index
  echo "$ZONENAME:installed:$ZPOOL_PATH/$ZONENAME:$UUID" >> /etc/zones/index

  #   3. zfs snapshot template_dataset
  #   4. zfs clone
  #   5. zfs set quota
  zfs snapshot "$ZPOOL_NAME/$ZONE_TEMPLATE@$ZONENAME"
  zfs clone "$ZPOOL_NAME/$ZONE_TEMPLATE@$ZONENAME" "$ZPOOL_NAME/$ZONENAME"
  zfs set "quota=${DISK_IN_GIGABYTES}g" "$ZPOOL_NAME/$ZONENAME"
else
  #   2. Append to /etc/zones/index
  zonecfg -z $ZONENAME create -X

  # b147 & later; install the zone now.
  if [ ! -z "$UUID" ]; then
    UUID_PARAM="-U $UUID"
  fi
  zoneadm -z $ZONENAME install -q ${DISK_IN_GIGABYTES} -t ${ZONE_TEMPLATE} $UUID_PARAM
fi

# Set customer-related properties on the ZFS dataset
DIR=`dirname $0`
source $DIR/zone_properties.sh

# 8. write to /etc/nodename

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
  # Set the network settings
  /usr/sbin/zonecfg -z $ZONENAME "select net physical=${PUBLIC_INTERFACE}; set vlan-id=${PUBLIC_VLAN_ID}; set global-nic=${PUBLIC_NIC}; end; exit"

  echo "$PUBLIC_IP netmask $PUBLIC_NETMASK up" > $ZONE_ROOT/etc/hostname.${PUBLIC_INTERFACE}
fi

if [ ! -z "$PRIVATE_IP" ];
then
  # Set the network settings
  /usr/sbin/zonecfg -z $ZONENAME "select net physical=${PRIVATE_INTERFACE}; set vlan-id=${PRIVATE_VLAN_ID}; set global-nic=${PRIVATE_NIC}; end; exit"

  echo "$PRIVATE_IP netmask $PRIVATE_NETMASK up" > $ZONE_ROOT/etc/hostname.${PRIVATE_INTERFACE}
fi

# 9. append to /etc/hostname.zonename

if [ ! -z "$DEFAULT_GATEWAY" ];
then
  echo "$DEFAULT_GATEWAY" > $ZONE_ROOT/etc/defaultrouter
fi

# 10. append to /etc/defaultrouter
# 11. write /root/zoneconfig

cat << __EOF__ | cat > $ZONE_ROOT/root/zoneconfig
$ZONECONFIG
__EOF__

ADMIN_HOME="$ZONE_ROOT/home/$ADMIN_USER"
ADMIN_PERMS=$(ls -l -d "${ADMIN_HOME}/.ssh" | awk '{ print $3 ":" $4 }')

if [ ! -z "$AUTHORIZED_KEYS" ]
then
  cat << __EOF__ | cat >> "$ADMIN_HOME/.ssh/authorized_keys"
$AUTHORIZED_KEYS
__EOF__

  chown $ADMIN_PERMS "$ADMIN_HOME/.ssh/authorized_keys"
fi

# touch log file path so we can start tailing immediately
cat /dev/null > $ZONE_ROOT/var/svc/log/system-zoneinit:default.log

# 12. boot

/usr/sbin/zoneadm -z $ZONENAME boot

# --- node
# 13. tail log file /var/log/zoneinit.log for success symbol
# 14. ack success to amqp
