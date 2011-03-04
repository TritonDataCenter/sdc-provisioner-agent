#!/bin/bash

svcadm disable -s provisioner
export AMQP_HOST=10.99.99.5
# export AMQP_LOGIN=guest
# export AMQP_PASSWORD=guest
# export NO_SYSINFO=1

source /lib/sdc/config.sh
load_sdc_sysinfo

export AMQP_USE_SYSTEM_CONFIG=1
export SERVER_UUID=$SYSINFO_UUID
export TEST_DATASET=bare-1.3.5

./local/bin/node provisioner-agent.js &
sleep 5

if [ ! -z "$1" ]; then
    ./local/bin/node $1
else
    ./local/bin/node ./junit-tests.js
fi
kill 0
