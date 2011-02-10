#!/bin/bash

SYSINFO=/bin/sysinfo
DEFAULT_UUID=550e8400-e29b-41d4-a716-446655440000

if [ -f "$SYSINFO" ]; then
    echo "Will use $SYSINFO to get UUID" >&2
elif [ ! -z "$SERVER_UUID" ]; then
    SERVER_UUID=$SERVER_UUID
    echo "Faking out SERVER_UUID to $SERVER_UUID" >&2
else
    SERVER_UUID=550e8400-e29b-41d4-a716-446655440000
    echo "No UUID specified and could not find ${SYSINFO}." >&2
    echo "Defaulting to ${DEFAULT_UUID}." >&2
fi

if [ -z "$TEST_DATASET" ]; then
    TEST_DATASET=bare-1.2.8
fi

echo "Using $TEST_DATASET as the test dataset" >&2

NODE_PATH=$PWD/node_modules

# Check if we're running on a smartos machine
if [ -f "/bin/sysinfo" ]; then
    AMQP_HOST=10.99.99.5
fi

export           \
  AMQP_HOST      \
  AMQP_LOGIN     \
  AMQP_PASSWORD  \
  NODE_PATH      \
  SERVER_UUID    \
  TEST_DATASET   \

$*
