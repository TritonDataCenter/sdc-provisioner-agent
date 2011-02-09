#!/bin/bash

svcadm disable -s provisioner
export AMQP_HOST=localhost
export AMQP_LOGIN=guest
export AMQP_PASSWORD=guest
export SERVER_UUID=my-silly-uuid
./test-env.sh local/bin/node provisioner-agent.js &
sleep 10
./test-env.sh local/bin/node ./junit-tests.js
kill 0
