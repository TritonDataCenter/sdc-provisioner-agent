#!/bin/bash

DIR=`dirname $0`

export BASEDIR=$npm_config_agent_root
export NODE_MODULES=$npm_config_root/node_modules
export ETC_DIR=$npm_config_etc
export VERSION=$npm_package_version

if [ ! -f "$ETC_DIR/provisioner.ini" ]; then
  cp $DIR/../etc/provisioner.ini $ETC_DIR/provisioner.ini
fi

gsed -e "s#@@BASEDIR@@#$BASEDIR#g" \
     -e "s/@@VERSION@@/$VERSION/g" \
     -e "s#@@NODE_MODULES@@#$NODE_MODULES#g" \
     -e "s#@@ETC_DIR@@#$ETC_DIR#g" \
     $DIR/../etc/provisioner.xml.in > $ETC_DIR/provisioner.xml

svccfg import $ETC_DIR/provisioner.xml

PROVISIONER_STATUS=`svcs -H provisioner | awk '{ print $1 }'`

echo "Provisioner status was $PROVISIONER_STATUS"

# Gracefully restart the agent if it is online.
if [ "$PROVISIONER_STATUS" = 'online' ]; then
  svcadm restart provisioner
else
  svcadm enable provisioner
fi
