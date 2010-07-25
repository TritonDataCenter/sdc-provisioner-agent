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
                , 'default_gateway'
                , 'private_netmask'
                , 'public_netmask'
                , 'cpu_shares'
                , 'lightweight_processes'
                , 'cpu_cap'
                , 'swap_in_bytes'
                , 'ram_in_bytes'
                ];

function keysToUpper (obj) {
  var OBJ = {};
  var keys = Object.keys(obj);
  var i = keys.length;
  while (i--) {
    OBJ[keys[i].toUpperCase()] = obj[keys[i]];
  }
  return OBJ;
}

ProvisionerAgent.prototype.zonePath = function (env) {
  return path.join("/", this.zpoolName, env.zonename);
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
      self.provision(msg);
      break;
    case 'teardown':
      self.teardown(msg);
      break;
  }
}

ProvisionerAgent.prototype.teardown = function (msg) {
  var self = this;
  var ENV = keysToUpper(msg.data);

  execFile(path.join(__dirname, '..', 'teardown.sh')
    , []
    , { env: ENV }
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
        puts("Ran teardown script, and it was ok.");
        self.ackSuccess(msg.id);
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

  // These are the names of the two interfaces inside the zone.
  env.public_interface = env.zonename + '0';
  env.private_interface = env.zonename + '2';

  env.zpool_name = self.zpoolName;
  env.zpool_path = self.zpoolPath;

  self.configureZone(env, function (zone_xml) {
    puts("Created configuration");

    // After this point, the agent will continue to handle new AMQP
    // requests. Because of this, we musn't modify any member variables
    // or depend on ones that will change (such as self.msg, etc).
    self.ackSuccess(self.msg.id);

    self.runProvisionScript(env);
  });
}

ProvisionerAgent.prototype.configureZone = function (env, callback) {
  var self = this;

  self.writeZoneXML(env, function () {
    self.writeZoneIndex(env, function () {
      callback();
    });
  });
}

ProvisionerAgent.prototype.writeZoneXML = function (env, callback) {
  var self = this;
  var zoneConfigPath = path.join("/etc/zones", env.zonename + ".xml");
  var zoneTemplatePath
    = path.join(__dirname, '..', 'support', 'zone_template.xml.ejs');

  if (path.exists(zoneConfigPath)) {
    self.ackError(self.msg.id,
      "Zone configuration file, " + zoneConfigPath + " already exists");
    return;
  }

  fs.readFile(zoneTemplatePath, function (error, data) {
    if (error) { 
      puts(error);
      self.provisionerEvent("error", env.zonename
        , { error: "Error reading " + zoneTemplatePath + ":"
                   + error.toString() });
      return;
    }
    puts(zoneTemplatePath);
    puts(data.toString());
    var zone_xml = ejs.render(data.toString(), { locals: env });
    fs.writeFile(zoneConfigPath, zone_xml, null, 'utf8', function (error) {
      if (error) {
        self.ackError(msg.id, error.toString());
        return;
      }
      callback();
    });
  });
}

ProvisionerAgent.prototype.writeZoneIndex = function (env, callback) {
  var self = this;
  var msg = self.msg;
  fs.open("/etc/zones/index", 'a', 0666, function (error, fd) {
    if (error) {
      self.ackError(msg.id, error.toString());
      return;
    }
    var str = env.zonename + ":installed:"
               + env.zpool_path + "/" + env.zonename + ":\n";
    fs.write(fd, str, null, 'utf8', function (error) {
      if (error) { self.ackError(msg.id, error.toString()); return; }

      callback();
    });
  });
}

ProvisionerAgent.prototype.runProvisionScript = function (env) {
  var self = this;

  var ENV = keysToUpper(env);
  var keys = Object.keys(ENV);
  var i = keys.length;

  var zoneConfig = '';

  while (i--) {
    zoneConfig += keys[i] + '=' + ENV[keys[i]] + "\n";
  }

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
      self.provisionerEvent("zone_created", env.zonename);

      puts("Ran provision script, and it was ok. Elapsed time till now: "
        + (Date.now() - self.start));
      self.followZoneinitServiceLog(env, {
        provision_sh: { stdout: stdout, stderr: stderr }
      });
    });
}

ProvisionerAgent.prototype.readZoneinitLog = function (env, callback) {
  var self = this;
  var logPath = path.join(self.zonePath(env), 'root/var/log/zoneinit.log');

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
  var logPath = path.join(self.zonePath(env),
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

