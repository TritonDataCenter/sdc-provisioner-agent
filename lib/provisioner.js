path = require('path');
require.paths.unshift(path.join(__dirname, '..'));

exec = require('child_process').exec;
fs = require("fs");
sys  = require('sys');
path  = require('path');

Template = require('Template');

AMQPAgent = require('amqp_agent').AMQPAgent;

exports.ProvisionerAgent = ProvisionerAgent = function (config) {
  var self = this;

  config = config || {};
  config.amqp = config.amqp || {};
  config.resource = "provisioner";
  self.debug = config.debug;

  AMQPAgent.call(this, config);
  this.registerCommand("provision");
  this.addListener("command", this.onCommand);
}

sys.inherits(ProvisionerAgent, AMQPAgent);

ProvisionerAgent.prototype.onCommand = function (command, msg) {
  var self = this;
  if (command !== "provision")
    return;

  var zone_name              = msg.zone_name
  var public_ip_address      = msg.zone_public_ip
  var private_ip_address     = msg.zone_private_ip
  var zone_template          = msg.zfs_dataset_name
  var public_interface_name  = msg.public_interface_name
  var private_interface_name = msg.private_interface_name
  var root_password          = msg.root_password
  var admin_password         = msg.admin_password
  var private_gateway        = msg.zone_private_default_gateway_ip
  var private_netmask        = msg.zone_private_netmask
  var zpool_name             = msg.zpool_name
  var zpool_path             = msg.zpool_path

  this.createZoneConfiguration(msg);

  self.ackSuccess(msg.id, { data: "whee" } );
}

ProvisionerAgent.prototype.createZoneConfiguration = function (msg) {
}
