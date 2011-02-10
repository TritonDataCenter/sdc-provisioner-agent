echo "Cleaning up zone $ZONENAME"

if [ -z "$ZONENAME" ];
then
  echo "ZONENAME environment variable must be set" >&2
  exit 1
fi

# deactivate
/usr/sbin/zoneadm -z "$ZONENAME" halt
/usr/sbin/zonecfg -z "$ZONENAME" set autoboot=false

# destroy
/usr/sbin/zoneadm -z "$ZONENAME" uninstall -F
/usr/sbin/zonecfg -z "$ZONENAME" delete -F

/usr/sbin/zfs destroy -rf "zones/$ZONENAME"

# destroy vnic
/usr/sbin/dladm delete-vnic "${ZONENAME}0" || true
/usr/sbin/dladm delete-vnic "${ZONENAME}2" || true
