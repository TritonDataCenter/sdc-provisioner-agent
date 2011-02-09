#!/bin/bash

if [[ `hostname` = 'bh1-autobuild' ]]; then
  pfexec mkdir -p $PUBLISH_LOCATION
  pfexec cp $DIRNAME/provisioner.tgz $PUBLISH_LOCATION
else
  echo scp
fi
