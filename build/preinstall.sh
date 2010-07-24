#grep provisioner /etc/passwd
#if [ "$?" != "0" ]; then
#  echo "Creating 'provisioner' user"
#  useradd -m \
#    -d $BASEDIR/provisioner \
#    -c "Dataset Manager Agent" \
#    -s /bin/zsh \
#    provisioner
#fi
