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
  this.registerCommand("teardown");

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

ProvisionerAgent.prototype.envToUpper = function (env) {
  var ENV = {};
  var keys = Object.keys(env);
  var i = keys.length;
  while (i--) {
    ENV[keys[i].toUpperCase()] = this.env[keys[i]];
  }
  return ENV;
}

ProvisionerAgent.prototype.zonePath = function (name) {
  return path.join("/", this.zpoolName, this.env.zonename);
}

ProvisionerAgent.prototype.provisionerEvent
  = function (eventType, zonename, msg) {
  var self = this;

  var routing_key = [self.config.resource, 'event', eventType
                    , self.hostname, zonename].join(".");
  console.log("Publishing event " + routing_key);
  msg = msg || {};
  self.exchange.publish(routing_key, msg);
}

ProvisionerAgent.prototype.onCommand = function (command, msg) {
  var self = this;

  if (!msg.data || !Object.keys(msg.data)) {
    self.ackError(msg.id, "Missing or empty 'data' field in request.");
    return;
  }

  var env = self.env = new Object(msg.data);

  self.msg = msg;
  self.start = Date.now();

  switch (command) {
    case 'provision':
      self.provision();
      break;
    case 'teardown':
      self.teardown();
      break;
  }
}

ProvisionerAgent.prototype.teardown = function () {
  var self = this;
  var ENV = self.envToUpper();

  execFile(path.join(__dirname, '..', 'teardown.sh')
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
      puts("Ran teardown script, and it was ok. Elapsed time till now: "
        + (Date.now() - self.start));
      self.ackSuccess(self.msg.id);
    });
}

ProvisionerAgent.prototype.provision = function () {
  var self = this;

  var msg = self.msg;
  var ki = REQUIRED_KEYS.length;
  var msgKeys = Object.keys(msg.data);

  while (ki--) {
    key = REQUIRED_KEYS[ki];
    if (msgKeys.indexOf(key) === -1) {
      self.ackError(msg.id, "Missing required key, '" + key + "'.");
      return;
    }
  }

  var env = new Object(msg.data);
  if (!env.additional_public_ips || !env.additional_public_ips.count) {
    env.additional_public_ips = [];
  }
  if (!env.additional_private_ips || !env.additional_private_ips.count) {
    env.additional_private_ips = [];
  }

  env.zpool_name = self.zpoolName;
  env.zpool_path = self.zpoolPath;
  env.public_interface_name = env.public_interface_name || '';

  self.configureZone(env, function (zone_xml) {
    puts("Created configuration");
    self.runProvisionScript(env);
  });
}

ProvisionerAgent.prototype.configureZone = function (env, callback) {
  var self = this;
  var zoneConfigPath = path.join("/etc/zones", env.zonename + ".xml");
  var zoneTemplatePath
    = path.join(__dirname, '..', 'support', 'zone_template.xml.ejs');

  if (path.exists(zoneConfigPath)) {
    self.ackError(self.msg.id,
      "Zone configuration file, " + zoneConfigPath + " already exists");
    return;
  }

  self.writeZoneIndex(env, function () {
    fs.readFile(zoneTemplatePath, function (error, data) {
      if (error) { puts(error); throw error; }
      puts("Wrote zone index file in: " + (Date.now() - self.start));

      self.zone_xml = ejs.render(data.toString(), { locals: env });
      callback && process.nextTick(function () {
        callback();
      });
    });
  });
}

ProvisionerAgent.prototype.writeZoneIndex = function (env, callback) {
  var self = this;
  fs.open("/etc/zones/index", 'a', 0666, function (error, fd) {
    if (error) {
      self.ackError(self.msg.id, error.toString());
      return;
    }
    var str = env.zonename + ":installed:"
               + env.zpool_path + "/" + env.zonename + ":\n";
    fs.write(fd, str, null, 'utf8', function (error) {
      if (error) { self.ackError(self.msg.id, error.toString()); return; }
      self.ackSuccess(self.msg.id);
      callback();
      return;
    });
  });
}

ProvisionerAgent.prototype.runProvisionScript = function (env) {
  var self = this;

  var ENV = self.envToUpper(env);
  var keys = Object.keys(ENV);
  var i = keys.length;

  var zoneConfig = '';

  while (i--) {
    zoneConfig += keys[i] + '=' + ENV[keys[i]] + "\n";
  }

  ENV.ZONECONFIG = zoneConfig;
  ENV.ZONE_XML = self.zone_xml;

  var provPath = './provision.sh';
  execFile(provPath
  , []
  , { env: ENV }
  , function (error, stdout, stderr) {
      if (error) {
        self.provisionerEvent("error", env.zonename
        , { error: error.toString()
          , error_code: error.code
          , stdout: stdout
          , stderr: stderr });
        return;
      }
      // fire an event here

      puts("Ran provision script, and it was ok. Elapsed time till now: "
        + (Date.now() - self.start));
      self.provisionerEvent("zone_created", env.zonename);
      self.followZoneinitServiceLog(env, {
        provision_sh: { stdout: stdout, stderr: stderr }
      });
    });
}

ProvisionerAgent.prototype.readZoneinitLog = function (env, callback) {
  var self = this;
  var logPath = path.join(self.zonePath(env.zonename),
                  'root/var/log/zoneinit.log');

  puts("Reading " + logPath);
  fs.readFile(logPath, function (error, data) {
    if (error)
      self.provisionerEvent("error", "Error reading " + logPath + ": " 
        + error.toString());
    callback(data);
  });
}

ProvisionerAgent.prototype.followZoneinitServiceLog
                                            = function (env, logs) {
  var self = this;

  // Create a file stream and then watch for exit
  var logPath = path.join(self.zonePath(env.zonename),
      'root/var/svc/log/system-zoneinit:default.log');

  puts("Watching " + logPath);
  var tail = spawn('/opt/local/bin/gtail', ['-F', logPath]);

  tail.stdout.on('data', function (data) {
    var lines = data.toString().split("\n");
    var ll = lines.length;

    while (ll--) {
      if (/Method "start" exited/.test(lines[ll])) {
        tail.kill();
        self.readZoneinitLog(env, function (log) {
          var logs = {};
          // fire event here
          logs.zoneinit_log = log.toString();
          self.provisionerEvent("zone_ready", env.zonename, { logs: logs });
        });
        return;
      }
    }
  });


  tail.stdout.on('error', function (error) {
    self.provisionerEvent("error", "Error tailing " + logPath + ": "
       + error.toString());
  });
};

