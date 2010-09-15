echo "Rebooting zone $ZONENAME"

if [ -z "$ZONENAME" ];
then
  echo "ZONENAME environment variable must be set" >&2
  exit 1
fi

# reboot
/usr/sbin/zoneadm -z "$ZONENAME" reboot
