#!/bin/sh

set -e

# Script to build collector in a bamboo remote running on a global zone,
# install it, and run some tests.

checkout() {
  sh ./submodules-init.sh
}

build() {
  gmake distclean
  gmake all
}

teardown() {
  if pkginfo -q JOYcollector; then
    sudo pkgrm -a ./admin -n JOYcollector
  fi
  if svcs -v collector 2> /dev/null; then
    echo "ERROR: collector service still running after teardown!"
    exit 1
  fi
  sudo rm -f /var/db/collector/collector.db
}

install() {
  sudo pkgadd -a ./admin -G -d ./JOYcollector-*.pkg all

  cat << __EOF__ | sudo sh -c 'cat - > /opt/collector/etc/collector.ini'
; Look up AMQP broker host via mDNS. Otherwise, specify a "host" and "port"
; parameter in the "amqp" section.
; mdns = amqp-broker
database_path = /var/db/collector/collector.db

; Ignore these zones
ignore_zone_ids = 0

; Hostname. If unset will use output of "hostname" command.
;hostname = foo

[amqp]
host = mq1-bamboo.staging.joyent.us
login = joyent
password = joytastic
__EOF__

  sudo svcadm restart collector

  if ! svcs -v collector 2> /dev/null; then
    echo "ERROR: collector service not running after install!"
    exit 1
  fi

  COLLECTOR_LOG=/var/svc/log/site-collector\:default.log
  echo "Last 100 lines of $COLLECTOR_LOG"
  tail -n 100 $COLLECTOR_LOG
}

run_test() {
  # remove old test result files
  rm -f tests/results/*.xml
  # needs some test reporting
  sudo sh -c "AMQP_HOST=mq1-bamboo.staging.joyent.us \
              AMQP_LOGIN=joyent \
              AMQP_PASSWORD=joytastic \
              AMQP_VHOST=/ \
              node/node junit-tests.js"
}

checkout
#build
#teardown
#install

run_test
