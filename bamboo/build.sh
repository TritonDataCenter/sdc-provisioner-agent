#!/bin/bash

set -e

DIRNAME=$(cd `dirname $0`; pwd)
gmake npm

NAME=provisioner
BRANCH=$(git symbolic-ref HEAD | cut -d'/' -f3)
DESCRIBE=$(git describe)
BUILDSTAMP=`TZ=UTC date "+%Y%m%dT%H%M%SZ"`; export BUILDSTAMP 
PKG=${NAME}-${BRANCH}-${BUILDSTAMP}-${DESCRIBE}.tgz
PUBLISH_LOCATION=/rpool/data/coal/live_147/agents/provisioner/${BRANCH}/

#pfexec ./run-tests.sh

source $DIRNAME/publish.sh
