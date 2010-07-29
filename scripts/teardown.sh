echo "Cleaning up zone $ZONENAME"

# ZONENAME=orlandozone

# deactivate
/usr/sbin/zoneadm -z $ZONENAME halt
/usr/sbin/zonecfg -z $ZONENAME set autoboot=false

# destroy
/usr/sbin/zoneadm -z $ZONENAME uninstall -F
/usr/sbin/zonecfg -z $ZONENAME delete -F

/usr/sbin/zfs destroy zones/ZONENAME
/usr/sbin/zfs destroy zones/nodejs@$ZONENAME

# destroy vnic
/usr/sbin/dladm delete-vnic ${ZONENAME}0 || true
/usr/sbin/dladm delete-vnic ${ZONENAME}2 || true
