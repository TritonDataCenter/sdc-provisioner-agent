#!/bin/bash
if [ -z "$TEST_DATASET" ]; then
    export TEST_DATASET=bare-1.2.8
fi
echo "Using $TEST_DATASET as the test dataset" >&2
    
AMQP_HOST=10.99.99.5 AMQP_LOGIN=guest AMQP_PASSWORD=guest NODE_PATH=`pwd`/node_modules node $1
