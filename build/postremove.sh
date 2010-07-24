#!/bin/bash

cd `dirname $0`
#rm /opt/provisioner/provisioner.db

svcadm disable provisioner
svccfg delete -f provisioner
# userdel provisioner
