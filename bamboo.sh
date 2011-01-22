#!/bin/sh

set -e

# Script to build provisioner in a bamboo remote running on a global zone,
# install it, and run some tests.

checkout() {
  sh ./submodules-init.sh
}

build() {
  gmake distclean
  gmake all
}

teardown() {
  if pkginfo -q JOYprovisioner; then
    sudo pkgrm -a ./build/admin -n JOYprovisioner
  fi
  if svcs -v provisioner 2> /dev/null; then
    echo "ERROR: provisioner service still running after teardown"
    exit 1
  fi
}

install() {
  sudo pkgadd -a ./build/admin -G -d ./JOYprovisioner-*.pkg all

  cat << __EOF__ | sudo sh -c 'cat - > /opt/provisioner/etc/provisioner.ini'
; Look up AMQP broker host via mDNS. Otherwise, specify a "host" and "port"
; parameter in the "amqp" section.
; mdns = amqp-broker

uuid = 550e8400-e29b-41d4-a716-446655440000

[amqp]
host = mq1-bamboo.staging.joyent.us
login = joyent
password = joytastic
__EOF__

  sudo svcadm restart provisioner

  if ! svcs -v provisioner 2> /dev/null; then
    echo "ERROR: provisioner service not running after install!"
    exit 1
  fi

  PROVISIONER_LOG=/var/svc/log/site-provisioner\:default.log
  echo "Last 100 lines of $PROVISIONER_LOG"
  tail -n 100 $PROVISIONER_LOG
}

run_test() {
  # remove old test result files
  rm -f tests/results/*.xml
  # needs some test reporting
  sudo sh -c "AMQP_HOST=mq1-bamboo.staging.joyent.us \
              AMQP_LOGIN=joyent \
              AMQP_PASSWORD=joytastic \
              AMQP_VHOST=/ \
              node junit-tests.js"
}

checkout
build
teardown
install

sleep 10
run_test
