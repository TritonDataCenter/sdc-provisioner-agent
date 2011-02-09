#!/bin/bash

set -e

DIRNAME=$(cd `dirname $0`; pwd)
gmake npm

NAME=provisioner
BRANCH=$(git symbolic-ref HEAD | cut -d'/' -f3)
DESCRIBE=$(git describe)
PKG=${NAME}-${BRANCH}-${DESCRIBE}.tgz
PUBLISH_LOCATION=/rpool/data/coal/live_147/agents/provisioner/${BRANCH}/

cd ..
./run-tests.sh

source $DIRNAME/publish.sh
