#!/bin/bash

export PATH=/var/tmp/usr/bin:/usr/node/bin:$PATH
export NODE_PATH=/usr/node_modules:/usr/vm/node_modules:/usr/img/node_modules

HBSTATUS=`svcs -Ho state provisioner`

if [[ "$HBSTATUS" == "online" ]]; then
  svcadm disable -s provisioner
fi

node bin/provisioner.js &
sleep 2

if [ -z "$*" ]; then
    TEST=test
else
    TEST=$*
fi

vmadm destroy '2e4a24af-97a2-4cb1-a2a4-1edb209fb311' && true
time node ./node_modules/nodeunit/bin/nodeunit $TEST
sleep 4

if [[ "$HBSTATUS" == "online" ]]; then
  svcadm enable -s provisioner
fi

kill 0
