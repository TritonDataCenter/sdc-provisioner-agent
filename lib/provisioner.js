path = require('path');
require.paths.unshift(path.join(__dirname, '..'));

execFile = require('child_process').execFile;
fs = require("fs");
sys  = require('sys');
path  = require('path');

LineProducer = require('line_producer').LineProducer;

Template = require('Template').Template;

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

REQUIRED_KEYS = [
                  'zone_name'
                , 'public_ip_address'
                , 'private_ip_address'
                , 'zone_template'
                , 'public_interface_name'
                , 'private_interface_name'
                , 'root_password'
                , 'admin_password'
                , 'private_gateway'
                , 'private_netmask'
                , 'cpu_shares'
                , 'lightweight_processes'
                , 'cpu_cap'
                , 'swap_in_bytes'
                , 'ram_in_bytes'
//                 , 'zpool_name'
//                 , 'zpool_path'
                ];

function runProvisionScript(env) {
  execFile(path.join(__dirname, 'provision.sh')
  , { env: env }
  , function (error, stdout, stderr) {
      if (error) {
        self.ackError(msg.id,
          { error: error.toString()
          , error_code: error.code
          , stdout: stdout
          , stderr: stderr
          });
        return;
      }

      var readStream = fs.createReadStream(
        path.join("/zones", zone_name, 'root/var/log/zoneinit.log'),
          { encoding: 'utf8' });

      var zoneinit_lines = [];
      var lp = new LineProducer();

      readStream.addListener('data', function (data) {
        lineProducer.push(data, function(lines) {
          var ll = lines.length;

          // extend zoneinit_lines array
          zoneinit_lines.splice.apply(
              zoneInit_lines,
              [zoneinit_lines.length, lines.length].concat(lines));

          while (ll--) {
            if (lines[ll] === "__SUCCESS__") {
              readStream.end();
              self.ackSucess(msg.id, { zoneinit_log: zoneinit_lines.join("\n") });
            }
          }
        });
      });
    });
}

ProvisionerAgent.prototype.onCommand = function (command, msg) {
  var self = this;
  if (command !== "provision")
    return;

  if (!msg.data || !Object.keys(data)) {
    self.ackError(msg.id, "Missing or empty 'data' field in request.");
  
  }

  var ki = REQUIRED_KEYS.length;
  var msgKeys = Object.keys(msg);

  while (ki--) {
    key = REQUIRED_KEYS[ki];
    if (msgKeys.indexOf(key) === -1) {
      self.ackError(msg.id, "Missing required key, '" + key + "'.");
      return;
    }
  }

//   var zone_name              = msg.zone_name
//   var public_ip_address      = msg.zone_public_ip
//   var private_ip_address     = msg.zone_private_ip
//   var zone_template          = msg.zfs_dataset_name
//   var public_interface_name  = msg.public_interface_name
//   var private_interface_name = msg.private_interface_name
//   var root_password          = msg.root_password
//   var admin_password         = msg.admin_password
//   var private_gateway        = msg.zone_private_default_gateway_ip
//   var private_netmask        = msg.zone_private_netmask
//   var zpool_name             = msg.zpool_name
//   var zpool_path             = msg.zpool_path

  this.createZoneConfiguration(msg, function (zone_xml) {
    puts("Created configuration");
    runProvisionScript(zone_xml);
  });
}

ProvisionerAgent.prototype.createZoneConfiguration = function (msg, callback) {
  var zoneConfigPath = path.join("/etc/zones", msg.zone_name + ".xml");
  var zoneTemplatePath
    = path.join(__dirname, '..', 'support', 'zone_template.xml.tt2');

  if (path.exists(zoneConfigPath)) {
    self.ackError(msg.id,
      "Zone configuration file, " + zoneConfigPath + " already exists");
  }

  fs.readFile(zoneTemplatePath, function (error, data) {
    if (error) throw error;
    var tt = new Template();
    var rendered = tt.process(data.toString(), msg);
    puts(rendered);
    callback && process.nextTick(function () {
      callback(rendered);
    });
  });
}
