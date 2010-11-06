echo "Deactivating zone $ZONENAME"

PATH=/usr/bin:/sbin:/usr/sbin
export PATH

if [ -z "$ZONENAME" ];
then
  echo "ZONENAME environment variable must be set" >&2
  exit 1
fi

if [ ! -z "$DELETED_AT" ]; then
  zfs set "com.joyent:deleted_at"="$DELETED_AT" "$ZPOOL_NAME/$ZONENAME"
fi

# deactivate
zonecfg -z "$ZONENAME" set autoboot=false
zoneadm -z "$ZONENAME" halt
