#!/bin/bash

set -e

ZONE_ROOT=/$ZPOOL_NAME/$ZONENAME/root

# --- node
# 0. recv amqp provision command
# 1. Write /etc/zones/zonename.xml

cat << __EOF__ | cat > /etc/zones/$ZONENAME.xml
$ZONE_XML
__EOF__

# --- shell
# 2. Edit /etc/zones/index

echo "$ZONENAME:installed:$ZPOOL_PATH/$ZONENAME:" >> /etc/zones/index

# 3. zfs snapshot template_dataset
# 4. zfs clone 
# 5. zfs set quota

/sbin/zfs snapshot "$ZPOOL_NAME/$ZONE_TEMPLATE@$ZONENAME"
/sbin/zfs clone "$ZPOOL_NAME/$ZONE_TEMPLATE@$ZONENAME" "$ZPOOL_NAME/$ZONENAME"
/sbin/zfs set "quota=${DISK_IN_GIGABYTES}g" "$ZPOOL_NAME/$ZONENAME"

# 8. write to /etc/nodename

echo "$HOSTNAME" > "$ZONE_ROOT/etc/nodename"

# vnics

/usr/sbin/dladm create-vnic -l e1000g0 ${ZONENAME}0
/usr/sbin/dladm create-vnic -l e1000g2 ${ZONENAME}2

# 9. append to /etc/hostname.zonename

echo "$PUBLIC_IP netmask $PUBLIC_NETMASK up" > $ZONE_ROOT/etc/hostname.${ZONENAME}0
echo "$PRIVATE_IP netmask $PRIVATE_NETMASK up" > $ZONE_ROOT/etc/hostname.${ZONENAME}2

echo "$DEFAULT_GATEWAY" > $ZONE_ROOT/etc/defaultrouter

# 10. append to /etc/defaultrouter
# 11. write /root/zoneconfig

cat << __EOF__ | cat > $ZONE_ROOT/root/zoneconfig
$ZONECONFIG
__EOF__

# touch log file path so we can start tailing immediately
touch $ZONE_ROOT/var/log/zoneinit.log

# 12. boot

/usr/sbin/zoneadm -z $ZONENAME boot

# --- node
# 13. tail log file /var/log/zoneinit.log for success symbol
# 14. ack success to amqp
