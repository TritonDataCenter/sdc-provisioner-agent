#!/bin/bash

DIR=`dirname $0`

export BASEDIR=$npm_config_agent_root
export MODULES=$npm_config_root
export NODE_MODULES=$npm_config_root/node_modules
export ETC_DIR=$npm_config_etc
export VERSION=$npm_package_version

if [ ! -f "$ETC_DIR/provisioner.ini" ]; then
  cp $DIR/../etc/provisioner.ini $ETC_DIR/provisioner.ini
fi

subfile () {
  IN=$1
  OUT=$2
  sed -e "s#@@BASEDIR@@#$BASEDIR#g" \
      -e "s/@@VERSION@@/$VERSION/g" \
      -e "s#@@MODULES@@#$MODULES#g" \
      -e "s#@@ETC_DIR@@#$ETC_DIR#g" \
      -e "s#@@SMF_DIR@@#$SMF_DIR#g" \
      -e "s#@@NODE_MODULES@@#$NODE_MODULES#g" \
      $IN > $OUT
}

subfile "$DIR/../etc/provisioner.xml.in" "$ETC_DIR/provisioner.xml"

svccfg import $ETC_DIR/provisioner.xml

PROVISIONER_STATUS=`svcs -H provisioner | awk '{ print $1 }'`

echo "Provisioner status was $PROVISIONER_STATUS"

# Gracefully restart the agent if it is online.
if [ "$PROVISIONER_STATUS" = 'online' ]; then
  svcadm restart provisioner
else
  svcadm enable provisioner
fi
