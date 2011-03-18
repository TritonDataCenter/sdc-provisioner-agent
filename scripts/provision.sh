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

# Add and configure vnics
count=0
while [ $count -lt 32 ]; do
  echo count=$count
  eval "IP=\${NET${count}_IP}"
  if [ -z "${IP}" ]; then
    break
  fi
  eval "NIC=\${NET${count}_NIC} \
  BLOCKED_OUTGOING_PORTS=\$NET${count}_BLOCKED_OUTGOING_PORTS \
  INTERFACE=\${NET${count}_INTERFACE} \
  MAC=\${NET${count}_MAC} \
  VLAN_ID=\${NET${count}_VLAN_ID} \
  ZONENAME=\${ZONENAME} \
  NETMASK=\${NET${count}_NETMASK} \
  IP=\${NET${count}_IP} \
  ZONE_ROOT=${ZONE_ROOT} \
    ${DIR}/add_vnic.sh"
  ((count++)) || true
done

if [ $count -eq 0 ]; then
  echo "Warning: creating zone with no networking"
fi


# Write the default gateway
if [ ! -z "$DEFAULT_GATEWAY" ];
then
  echo "$DEFAULT_GATEWAY" > $ZONE_ROOT/etc/defaultrouter
fi

# Write the config settings to zoneconfig where the zone will be able to read
# them.
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

# Remove once zoneinit does this for us
cat > ${ZONE_ROOT}/root/zoneinit.d/01-reboot-file.sh <<EOF
if [[ ! -f /tmp/.FIRST_REBOOT_NOT_YET_COMPLETE ]]; then
    touch /tmp/.FIRST_REBOOT_NOT_YET_COMPLETE
fi
EOF

# Add zone metadata
source $DIR/zone_properties.sh

/usr/sbin/zoneadm -z $ZONENAME boot -X
