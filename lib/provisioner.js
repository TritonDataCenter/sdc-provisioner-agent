path = require('path');
require.paths.unshift(path.join(__dirname, '..'));

fs = require("fs");
sys  = require('sys');
path  = require('path');
ejs  = require('ejs');

spawn = require('child_process').spawn;
execFile = require('child_process').execFile;

AMQPAgent = require('amqp_agent').AMQPAgent;

exports.ProvisionerAgent = ProvisionerAgent = function (config) {
  config = config || {};
  config.amqp = config.amqp || {};
  config.resource = "provisioner";
  this.debug = config.debug;

  this.zpoolName = "zones";
  this.zpoolPath = path.join("/", this.zpoolName);

  AMQPAgent.call(this, config);

  this.registerCommand("provision");
//   this.registerCommand("teardown");

  this.addListener("command", this.onCommand);
}

sys.inherits(ProvisionerAgent, AMQPAgent);

REQUIRED_KEYS = [ 'zonename'
                , 'hostname'
                , 'public_ip'
                , 'new_ip'
                , 'private_ip'
                , 'vs_pw'
                , 'root_pw'
                , 'admin_pw'
                , 'zone_template'
                , 'template_version'
                , 'tmpfs'
                , 'public_interface_name'
                , 'private_interface_name'
                , 'default_gateway'
                , 'private_netmask'
                , 'public_netmask'
                , 'cpu_shares'
                , 'lightweight_processes'
                , 'cpu_cap'
                , 'swap_in_bytes'
                , 'ram_in_bytes'
                ];

ProvisionerAgent.prototype.envToUpper = function () {
  var ENV = {};
  var keys = Object.keys(this.env);
  var i = keys.length;
  while (i--) {
    ENV[keys[i].toUpperCase()] = this.env[keys[i]];
  }
  return ENV;
}

ProvisionerAgent.prototype.zonePath = function (name) {
  return path.join("/", this.zpoolName, this.env.zonename);
}

ProvisionerAgent.prototype.tailZoneInitLog = function () {
  var self = this;

  // Create a file stream and then watch for success or failure
  var logPath = path.join(self.zonePath(self.env.zonename),
      'root/var/log/zoneinit.log');

  var logLines = [];

  var tail = spawn('/bin/tail', ['-f', logPath]);

  tail.stdout.on('data', function (data) {
    var lines = data.toString().split("\n");
    var ll = lines.length;

    while (ll--) {
      logLines.push(lines[ll]);
//      if (/ERROR/.test(lines[ll])) {
//        tail.kill();
//        self.ackError(self.msg.id,
//          { elapsed:      Date.now() - self.start,
//            zoneinit_log: logLines.join("\n") });
//        return;
//      }
      if (lines[ll] === "__SUCCESS__") {
        tail.kill();
        self.ackSuccess(self.msg.id,
          { data: { elapsed:      Date.now() - self.start,
                    zoneinit_log: logLines.join("\n") } });
        return;
      }
    }
    logLines.push(data.toString());
  });

  tail.stdout.on('error', function (error) {
    self.ackError(self.msg.id, error.toString());
  });
};

ProvisionerAgent.prototype.runProvisionScript = function () {
  var self = this;

  var ENV = this.envToUpper();
  var keys = Object.keys(ENV);
  var i = keys.length;

  var zoneConfig = '';

  while (i--) {
    zoneConfig += keys[i] + '=' + ENV[keys[i]] + "\n";
  }

  ENV.ZONECONFIG = zoneConfig;
  ENV.ZONE_XML = self.zone_xml;

  execFile(path.join(__dirname, '..', 'provision.sh')
  , []
  , { env: ENV }
  , function (error, stdout, stderr) {
      if (error) {
        self.ackError(self.msg.id,
          { error: error.toString()
          , error_code: error.code
          , stdout: stdout
          , stderr: stderr
          });
        return;
      }
      puts("Ran provision script, and it was ok. Elapsed time till now: "
        + (Date.now() - self.start));
      self.tailZoneInitLog();
    });
}

ProvisionerAgent.prototype.onCommand = function (command, msg) {
  var self = this;
  if (command !== "provision")
    return;

  if (!msg.data || !Object.keys(msg.data)) {
    self.ackError(msg.id, "Missing or empty 'data' field in request.");
    return;
  }

  switch (command) {
    case 'provision':
      self.provision(msg);
      break;
//     case 'teardown':
//       self.teardown(msg);
//       break;
  }
}

// ProvisionerAgent.prototype.teardown = function (msg) {
//   self.ackSuccess(msg.id);
// }

ProvisionerAgent.prototype.provision = function (msg) {
  var self = this;

  this.msg = msg;

  self.start = Date.now();

  var ki = REQUIRED_KEYS.length;
  var msgKeys = Object.keys(msg.data);

  while (ki--) {
    key = REQUIRED_KEYS[ki];
    if (msgKeys.indexOf(key) === -1) {
      self.ackError(msg.id, "Missing required key, '" + key + "'.");
      return;
    }
  }

  var env = this.env = new Object(msg.data);
  if (!env.additional_public_ips || !env.additional_public_ips.count) {
    env.additional_public_ips = [];
  }
  if (!env.additional_private_ips || !env.additional_private_ips.count) {
    env.additional_private_ips = [];
  }

  this.env.zpool_name = self.zpoolName;
  this.env.zpool_path = self.zpoolPath;
  this.env.public_interface_name = this.env.public_interface_name || '';
  this.env.public_ip = this.env.public_ip || '';

  this.configureZone(function (zone_xml) {
    puts("Created configuration");
    puts(inspect(self.env));
    self.runProvisionScript();
  });
}

ProvisionerAgent.prototype.configureZone = function (callback) {
  var self = this;
  var zoneConfigPath = path.join("/etc/zones", this.env.zonename + ".xml");
  var zoneTemplatePath
    = path.join(__dirname, '..', 'support', 'zone_template.xml.ejs');

  if (path.exists(zoneConfigPath)) {
    self.ackError(self.msg.id,
      "Zone configuration file, " + zoneConfigPath + " already exists");
    return;
  }

  fs.readFile(zoneTemplatePath, function (error, data) {
    if (error) { puts(error); throw error; }

    self.zone_xml = ejs.render(data.toString(), { locals: self.env });
    callback && process.nextTick(function () {
      callback();
    });
  });
}
