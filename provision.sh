#!/bin/bash

set -e

ZONE_ROOT=/$zpool_name/$zone_name/root

# --- node
# 0. recv amqp provision command
# 1. Write /etc/zones/zonename.xml

# --- shell
# 2. Edit /etc/zones/index

echo "$zone_name:installed:$zpool_path/$zone_name:" >> /etc/zones/index

# 3. zfs snapshot template_dataset
# 4. zfs clone 
# 5. zfs set quota

/sbin/zfs snapshot "$zpool_name/$zone_template@$zone_name"
/sbin/zfs clone "$zpool_name/$zone_template@$zone_name" "$zpool_name/$zone_name"
/sbin/zfs set "quota=${disk_in_gigabytes}g" "$zpool_name/$zone_name"

# 6. vfstab template
# 7. write vfstab to /etc/vfstab

cat << __EOF__ > "$ZONE_ROOT/etc/vfstab"
#device         device          mount           FS      fsck    mount   mount
#to mount       to fsck         point           type    pass    at boot options
#
/proc           -               /proc           proc    -       no      -
ctfs            -               /system/contract ctfs   -       no      -
objfs           -               /system/object  objfs   -       no      -
sharefs         -               /etc/dfs/sharetab       sharefs -       no      -
fd              -               /dev/fd         fd      -       no      -
swap            -               /tmp            tmpfs   -       yes     size=$tmp_size,nosuid
__EOF__

# 8. write to /etc/nodename

echo "$zone_host_name" > "$ZONE_ROOT/etc/nodename"

# something about vnics

dladm create-vnic -l $physical_interface_name ${zone_name}2

# 9. append to /etc/hostname.zonename

echo "$private_ip_address netmask $private_netmask up" > $ZONE_ROOT/etc/hostname.${zone_name}2
echo "$private_gateway" > $ZONE_ROOT/etc/defaultrouter

# 10. append to /etc/defaultrouter
# 11. write /root/zoneconfig
# 12. boot

# --- node
# 13. tail log file /var/log/zoneinit.log for success symbol
# 14. ack success to amqp

echo "O HAI"
echo $*
export
