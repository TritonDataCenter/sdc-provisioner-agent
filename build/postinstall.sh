echo 'Updating the Solaris SMF'
svccfg import $BASEDIR/provisioner/provisioner.xml
svcadm enable provisioner
svcs -v provisioner

if [ ! -f $BASEDIR/provisioner/etc/provisioner.ini ]; then
  cp $BASEDIR/provisioner/etc/provisioner.ini-sample $BASEDIR/provisioner/etc/provisioner.ini
fi

echo ""
echo "Edit $BASEDIR/provisioner/etc/provisioner.ini to set you AMQP config"
echo ""
echo ""
echo "Now run 'svcadm enable provisioner'"
echo ""
echo ""

