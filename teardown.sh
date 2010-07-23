echo "Cleaning up zone $ZONENAME"

ZONENAME=orlandozone

# deactivate
sudo /usr/sbin/zoneadm -z $ZONENAME halt
sudo /usr/sbin/zonecfg -z $ZONENAME set autoboot=false

# destroy
sudo /usr/sbin/zoneadm -z $ZONENAME uninstall -F
sudo /usr/sbin/zonecfg -z $ZONENAME delete -F

sudo zfs destroy -f -R zones/nodejs@$ZONENAME
sudo zfs destroy -f zones/$ZONENAME
sudo rm /etc/zones/$ZONENAME.xml
sudo cp /etc/zones/index-orlando /etc/zones/index

# destroy vnic
sudo /usr/sbin/dladm delete-vnic ${ZONENAME}0
sudo /usr/sbin/dladm delete-vnic ${ZONENAME}2
