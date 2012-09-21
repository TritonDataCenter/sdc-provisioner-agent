export SMFDIR=$npm_config_smfdir

svcadm disable -s provisioner
svccfg delete provisioner

rm -f "$SMFDIR/provisioner.xml"
