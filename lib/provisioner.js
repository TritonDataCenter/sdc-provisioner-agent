path = require('path');
require.paths.unshift(path.join(__dirname, '..', 'lib'));

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
//                 , 'public_ip'
//                 , 'new_ip'
//                 , 'private_ip'
                , 'vs_pw'
                , 'root_pw'
                , 'admin_pw'
                , 'zone_template'
                , 'template_version'
                , 'tmpfs'
//                 , 'default_gateway'
//                 , 'private_netmask'
//                 , 'public_netmask'
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
  msg = msg || {};
  console.log("Publishing event(%s):\n%j", routing_key, msg);
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

  self.ackSuccess(msg.id);
  execFile(path.join(__dirname, '..', 'scripts', 'teardown.sh')
    , []
    , { env: ENV }
    , function (error, stdout, stderr) {
        if (error) {
          self.provisionerEvent("error"
                                , msg.data.zonename
                                , { error: error.toString()
                                  , error_code: error.code
                                  , stdout: stdout
                                  , stderr: stderr
                                  });
          return;
        }
        puts("Ran teardown script, and it was ok.");
        self.provisionerEvent("zone_destroyed", msg.data.zonename);
      });
}

// Create a zone when given a few values
ProvisionerAgent.prototype.provision = function () {
  var self = this;

  var msg = self.msg;
  var ki = REQUIRED_KEYS.length;
  var msgKeys = Object.keys(msg.data);
//     self.ackSuccess(self.msg.id);
//     return;

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

  env.public_ip = env.public_ip || '';
  env.private_ip = env.private_ip || '';

  env.zpool_name = self.zpoolName;
  env.zpool_path = self.zpoolPath;

  self.configureZone(env, function (zone_xml) {
    puts("Created configuration");

    // After this point, the agent will continue to handle new AMQP
    // requests. Because of this, we musn't modify any member variables
    // or depend on ones that will change (such as self.msg, etc).
    // Also past this point, if we wish to communicate back with the client,
    // we should use the provisionEvent method rather than
    // ackSuccess/ackFailure.
    self.ackSuccess(self.msg.id);
    delete self.msg;

    self.runProvisionScript(env);
  });
}

// Write out the two global zone configuration files
ProvisionerAgent.prototype.configureZone = function (env, callback) {
  var self = this;

  var count = 2;

  function _cb (error) {
    puts("Callback");
    if (error) {
      self.ackError(self.msg.id, error);
      return;
    }

    if (!--count) {
      puts("CONTINUING");
      callback();
    }
  }

  self.writeZoneXML(env, _cb);
  self.writeZoneIndex(env, _cb);
}

function _writeTemplate(args, callback) {
  var zoneXML = ejs.render(args.zoneXMLTemplate, { locals: args.env });
  fs.writeFile(args.zoneConfigPath, zoneXML, null, 'utf8', function (error) {
    if (error) {
      callback(error.toString());
      return;
    }
    callback(null);
  });
}

ZONE_TEMPLATE_PATH
    = path.join(__dirname, '..', 'support', 'zone_template.xml.ejs');

// Expand out the zone xml ejs template and write out the rendered string to
// /etc/zones/$zonename.xml
ProvisionerAgent.prototype.writeZoneXML = function (env, callback) {
  var self = this;
  var zoneConfigPath = path.join("/etc/zones", env.zonename + ".xml");

  if (path.exists(zoneConfigPath)) {
    self.ackError(self.msg.id,
      "Zone configuration file, " + zoneConfigPath + " already exists");
    return;
  }

  if (!self.zoneXMLTemplate) {
    fs.readFile(ZONE_TEMPLATE_PATH, function (error, data) {
      if (error) {
        callback("Error reading " + ZONE_TEMPLATE_PATH + ": "
                 + error.toString());
        return;
      }
      self.zoneXMLTemplate = data.toString();
      _writeTemplate({ env: env
                     , zoneXMLTemplate: self.zoneXMLTemplate
                     , zoneConfigPath: zoneConfigPath
                     }, callback);
    });
  }
  else {
    _writeTemplate({ env: env
                   , zoneXMLTemplate: self.zoneXMLTemplate
                   , zoneConfigPath: zoneConfigPath
                   }, callback);
  }
}

// Append to the /etc/zones/index file
ProvisionerAgent.prototype.writeZoneIndex = function (env, callback) {
  var self = this;
  var msg = self.msg;
  fs.open("/etc/zones/index", 'a', 0666, function (error, fd) {
    if (error) {
      self.ackError(msg.id, error.toString());
      return;
    }
    var str = [ env.zonename
              , 'installed',
              , path.join(env.zpool_path, env.zonename)
              , ''
              ].join(':') + "\n";

    fs.write(fd, str, null, 'utf8', function (error) {
      if (error) {
        self.ackError(msg.id, error.toString());
        return;
      }

      fs.close(fd, function (error) {
        if (error) {
          self.ackError(msg.id, error.toString());
          return;
        }
        callback();
      });
    });
  });
}

// Run the provision shell script that does all the zone configuration that
// needs to happen at the global zone level.
ProvisionerAgent.prototype.runProvisionScript = function (env) {
  var self = this;

  var ENV = keysToUpper(env);
  var keys = Object.keys(ENV);
  var i = keys.length;

  var zoneConfig = '';

  while (i--) {
    if (['authorized_keys'].indexOf(keys[i]) !== -1) {
      continue;
    }
    zoneConfig += keys[i] + '="' + String(ENV[keys[i]]).replace("\\","\\\\")
                                                       .replace("\"","\\\"") + "\"\n";
  }

  ENV.ZONECONFIG = zoneConfig;

  var provPath = path.join(__dirname, '..', 'scripts', 'provision.sh');
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

      puts("Ran provision script, and it was ok.");
      self.followZoneinitServiceLog(env, {
        provision_sh: { stdout: stdout, stderr: stderr }
      });
    });
}

// Read the zone's /var/log/zoninit.log
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

// Follow (with tail -f) the booting zone's
// /var/svc/log/system-zoneinit:default.log file and run the callback when
// completed.
ProvisionerAgent.prototype.followZoneinitServiceLog = function (env, logs) {
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

