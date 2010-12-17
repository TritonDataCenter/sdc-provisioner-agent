export SMFDIR=$npm_config_smfdir

if svcs provisioner; then
  svcadm disable -s provisioner
  svccfg delete provisioner
fi

rm -f "$SMFDIR/provisioner.xml"
