#!/bin/bash

# This script is responsible for the zone configuration that needs to happen
# at the global zone level. The provisioner agent sets up the zone's xml
# file and then calls this script. At that point, the provisiner agent will
# continue handling AMQP requests, while this script "runs in the background"
# and eventually boots the new zone.

set -e

PATH=/usr/bin:/sbin:/usr/sbin
export PATH

ZONE_ROOT=/$ZPOOL_NAME/$ZONENAME/root

# --- node
# 0. recv amqp provision command
# 1. Write /etc/zones/zonename.xml

# check if dataset exists

DATASETEXISTS=`zfs list "$ZPOOL_NAME/$ZONENAME" 2>&1; echo $?`

if [ "$DATASETEXISTS" == 0 ]; then
  echo "Dataset $ZPOOL_NAME/$ZONENAME exists." >&2;
  exit 1
fi

if [ $BASEOS_VERS -lt 147 ]; then
  # pre b147 systems
  #   2. Append to /etc/zones/index
  echo "$ZONENAME:installed:$ZPOOL_PATH/$ZONENAME:" >>/etc/zones/index

  #   3. zfs snapshot template_dataset
  #   4. zfs clone
  #   5. zfs set quota
  zfs snapshot "$ZPOOL_NAME/$ZONE_TEMPLATE@$ZONENAME"
  zfs clone "$ZPOOL_NAME/$ZONE_TEMPLATE@$ZONENAME" "$ZPOOL_NAME/$ZONENAME"
  zfs set "quota=${DISK_IN_GIGABYTES}g" "$ZPOOL_NAME/$ZONENAME"
else
  # b147 & later; install the zone now.
  zoneadm -z $ZONENAME install -q ${DISK_IN_GIGABYTES}g -t $ZONE_TEMPLATE
fi

# 8. write to /etc/nodename

echo "$HOSTNAME" > "$ZONE_ROOT/etc/nodename"

# vnics

if [ ! -z "$PUBLIC_IP" ];
then
  /usr/sbin/dladm create-vnic -l ${EXTERNAL_LINK} -v ${PUBLIC_VLAN_ID} ${PUBLIC_INTERFACE}
  echo "$PUBLIC_IP netmask $PUBLIC_NETMASK up" > $ZONE_ROOT/etc/hostname.${PUBLIC_INTERFACE}
fi

if [ ! -z "$PRIVATE_IP" ];
then
  /usr/sbin/dladm create-vnic -l ${INTERNAL_LINK} -v ${PRIVATE_VLAN_ID} ${PRIVATE_INTERFACE}
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
