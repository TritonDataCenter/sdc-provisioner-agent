echo "Cleaning up zone $ZONENAME"

ZONENAME=orlandozone

# deactivate
/usr/sbin/zoneadm -z $ZONENAME halt
/usr/sbin/zonecfg -z $ZONENAME set autoboot=false

# destroy
/usr/sbin/zoneadm -z $ZONENAME uninstall -F
/usr/sbin/zonecfg -z $ZONENAME delete -F

zfs destroy -f -R zones/nodejs@$ZONENAME
zfs destroy -f zones/$ZONENAME
rm /etc/zones/$ZONENAME.xml
cp /etc/zones/index-orlando /etc/zones/index

# destroy vnic
/usr/sbin/dladm delete-vnic ${ZONENAME}0
/usr/sbin/dladm delete-vnic ${ZONENAME}2
