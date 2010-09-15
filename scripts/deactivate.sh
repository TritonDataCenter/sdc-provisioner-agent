echo "Deactivating zone $ZONENAME"

if [ -z "$ZONENAME" ];
then
  echo "ZONENAME environment variable must be set" >&2
  exit 1
fi

# deactivate
/usr/sbin/zonecfg -z "$ZONENAME" set autoboot=false
/usr/sbin/zoneadm -z "$ZONENAME" halt
