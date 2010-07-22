path = require('path');
require.paths.unshift(path.join(__dirname, '..'));

execFile = require('child_process').execFile;
fs = require("fs");
sys  = require('sys');
path  = require('path');
ejs  = require('ejs');

LineProducer = require('line_producer').LineProducer;

AMQPAgent = require('amqp_agent').AMQPAgent;

exports.ProvisionerAgent = ProvisionerAgent = function (config) {
  var self = this;

  config = config || {};
  config.amqp = config.amqp || {};
  config.resource = "provisioner";
  self.debug = config.debug;

  self.zpoolName = "zones";
  self.zpoolPath = path.join("/", self.zpoolName);

  AMQPAgent.call(this, config);
  this.registerCommand("provision");
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

extend = function(destination, source) {
  for (var property in source)
    destination[property] = source[property];
  return destination;
}

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

ProvisionerAgent.prototype.afterProvisionScript = function () {
  var self = this;

  // Create a file stream and then watch for success or failure
  var logPath = path.join(self.zonePath(self.env.zonename) ,
      'root/var/log/zoneinit.log');

  var wait = 1000;
  var timeout = 10000;
  var waited = 0;

  var lp = new LineProducer();
  var zoneinit_lines = [];

  function checkZoneInitLog(data, stream) {
    lp.push(data, function(lines) {
      puts(inspect(lines));
      var ll = lines.length;

      // extend zoneinit_lines array
      zoneinit_lines.splice.apply(
          zoneinit_lines,
          [zoneinit_lines.length, lines.length].concat(lines));

      while (ll--) {
        if (lines[ll] === "__SUCCESS__") {
          stream.close();
          self.ackSucess(self.msg.id, { zoneinit_log: zoneinit_lines.join("\n") });
          return;
        }
      }
    });
  }

  var interval = setInterval(function () {
    try {
      var readStream = fs.createReadStream(logPath, { encoding: 'utf8' });

      readStream.on('error', function (error) {
        puts ("ERROR" +inspect(arguments));
      });

      readStream.on('data', function (data) {
        puts("Data received" + data.toString());
        clearInterval(interval);
        //checkZoneInitLog(data, readStream);
      });
    }
    catch (e) {
      waited += wait;
      if (waited > timeout) {
        cancelInterval(interval);
        self.ackError(self.msg.id, e.toString());
        return;
      }
      puts("File doesn't exist yet, waiting...");
    }
  }, wait);


  /*
  }); */
};

ProvisionerAgent.prototype.runProvisionScript = function () {
  var self = this;

  var ENV = this.envToUpper();
  var keys = Object.keys(ENV);
  var i = keys.length;

  var zoneConfig = '';

  while (i--) {
    if (keys[i] == 'ZONE_XML') continue;
    zoneConfig += keys[i] + '=' + ENV[keys[i]] + "\n";
  }
  ENV.ZONECONFIG = zoneConfig;

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
      self.afterProvisionScript(self.msg);
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

  this.msg = msg;

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
    self.env.zone_xml = zone_xml;
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

    var zone_xml = ejs.render(data.toString(), { locals: self.env });
//    puts(zone_xml);
    callback && process.nextTick(function () {
      callback(zone_xml);
    });
  });
}
