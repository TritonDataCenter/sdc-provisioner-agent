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

  self.zonesPool = "zones";
  self.zonesPath = path.join("/", self.zonesPool);

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
                ];

extend = function(destination, source) {
  for (var property in source)
    destination[property] = source[property];
  return destination;
}

ProvisionerAgent.prototype.afterProvisionScript = function (env) {

  // Create a file stream and then watch for success or failure
  var readStream = fs.createReadStream(
    path.join("/", this.zonesPool, env.zone_name, 'root/var/log/zoneinit.log'),
      { encoding: 'utf8' });

  var zoneinit_lines = [];
  var lp = new LineProducer();

  readStream.addListener('error', function (error) {
    self.ackError(msg.id, error.toString());
  });
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
          return;
        }
      }
    });
  });
};

ProvisionerAgent.prototype.runProvisionScript = function (msg, env) {
  var self = this;
  execFile(path.join(__dirname, '..', 'provision.sh')
  , []
  , {}
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
      self.afterProvisionScript(env);
    }
  , env);
}

ProvisionerAgent.prototype.onCommand = function (command, msg) {
  var self = this;
  if (command !== "provision")
    return;

  if (!msg.data || !Object.keys(msg.data)) {
    self.ackError(msg.id, "Missing or empty 'data' field in request.");
  
    return;
  }

  var ki = REQUIRED_KEYS.length;
  var msgKeys = Object.keys(msg.data);

  while (ki--) {
    key = REQUIRED_KEYS[ki];
    if (msgKeys.indexOf(key) === -1) {
      self.ackError(msg.id, "Missing required key, '" + key + "'.");
      return;
    }
  }

  this.createZoneConfiguration(msg, function (zone_xml) {
    puts("Created configuration");
    var env = new Object(msg.data);
    env.zone_xml = zone_xml;
    self.runProvisionScript(msg, env);
  });
}

ProvisionerAgent.prototype.createZoneConfiguration = function (msg, callback) {
  var zoneConfigPath = path.join("/etc/zones", msg.zone_name + ".xml");
  var zoneTemplatePath
    = path.join(__dirname, '..', 'support', 'zone_template.xml.tt2');

  if (path.exists(zoneConfigPath)) {
    self.ackError(msg.id,
      "Zone configuration file, " + zoneConfigPath + " already exists");
    return;
  }

  fs.readFile(zoneTemplatePath, function (error, data) {
    if (error) throw error;
    var tt = new Template();
    var zone_xml = tt.process(data.toString(), msg);
    callback && process.nextTick(function () {
      callback(zone_xml);
    });
  });
}
