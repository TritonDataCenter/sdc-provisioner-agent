#!/bin/bash

# This script is responsible for the zone configuration that needs to happen
# at the global zone level. The provisioner agent appends to the zone index
# file and then calls this script. At that point, the provisiner agent will
# continue handling AMQP requests, while this script "runs in the background"
# and eventually boots the new zone.

set -e

ZONE_ROOT=/$ZPOOL_NAME/$ZONENAME/root

# --- node
# 0. recv amqp provision command


# 1. Write /etc/zones/zonename.xml

# --- node
# 2. Append to /etc/zones/index
# 3. zfs snapshot template_dataset
# 4. zfs clone
# 5. zfs set quota

# 8. write to /etc/nodename

echo "$HOSTNAME" > "$ZONE_ROOT/etc/nodename"

# vnics

if [ ! -z "$PUBLIC_IP" ];
then
  /usr/sbin/dladm create-vnic -l ${EXTERNAL_LINK} ${PUBLIC_INTERFACE}
  echo "$PUBLIC_IP netmask $PUBLIC_NETMASK up" > $ZONE_ROOT/etc/hostname.${PUBLIC_INTERFACE}
fi

if [ ! -z "$PRIVATE_IP" ];
then
  /usr/sbin/dladm create-vnic -l ${INTERNAL_LINK} ${PRIVATE_INTERFACE}
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

if [ ! -z "$AUTHORIZED_KEYS" ]
then
  cat << __EOF__ | cat >> $ZONE_ROOT/home/node/.ssh/authorized_keys
$AUTHORIZED_KEYS
__EOF__
fi

# touch log file path so we can start tailing immediately
cat /dev/null > $ZONE_ROOT/var/svc/log/system-zoneinit:default.log

# 12. boot

/usr/sbin/zoneadm -z $ZONENAME boot

# --- node
# 13. tail log file /var/log/zoneinit.log for success symbol
# 14. ack success to amqp
