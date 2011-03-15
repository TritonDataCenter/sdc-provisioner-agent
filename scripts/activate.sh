echo "Activating zone $ZONENAME"

if [ -z "$ZONENAME" ];
then
  echo "ZONENAME environment variable must be set" >&2
  exit 1
fi

# Remove attr if it exists already.
zonecfg -z "$ZONENAME" "remove attr name=deleted-at; commit" || true

# activate
/usr/sbin/zonecfg -z "$ZONENAME" set autoboot=true
/usr/sbin/zoneadm -z "$ZONENAME" boot
