#!/bin/bash

set -e

gmake npm

NAME=provisioner
BRANCH=$(git symbolic-ref HEAD | cut -d'/' -f3)
DESCRIBE=$(git describe)
PKG=${NAME}-${BRANCH}-${DESCRIBE}.tgz
PUBLISH_LOCATION=/rpool/data/coal/live_147/agents/provisioner/${BRANCH}/

if [[ `hostname` = 'bh1-autobuild' ]]; then
  pfexec mkdir -p $PUBLISH_LOCATION
  pfexec cp provisioner.tgz $PUBLISH_LOCATION
else
  echo scp
fi
