echo 'Updating the Solaris SMF'
svccfg import $BASEDIR/provisioner/provisioner.xml
svcadm enable provisioner
svcs -v provisioner

echo ""
echo "Edit $BASEDIR/provisioner/etc/provisioner.ini to set you AMQP config"
echo ""
echo ""
echo "Now run 'svcadm enable provisioner'"
echo ""
echo ""

