#!/bin/bash

DIR=`dirname $0`

export BASEDIR=$npm_config_agent_root
export MODULES=$npm_config_root
export ETC_DIR=$npm_config_etc
export SMF_DIR=$npm_config_smfdir
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
      -e "s#@@SMFDIR@@#$SMFDIR#g"   \
      $IN > $OUT
}

subfile "$DIR/../etc/provisioner.xml.in" "$SMF_DIR/provisioner.xml"
svccfg import $SMF_DIR/provisioner.xml
