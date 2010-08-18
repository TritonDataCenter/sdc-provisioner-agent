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
  var self = this;

  config = config || {};
  config.amqp = config.amqp || {};
  config.resource = 'provisioner';
  this.debug = config.debug;

  AMQPAgent.call(this, config);

  this.provisionCount = 0;
  this.provisionQueue = [];

  this.registerCommand('provision');
  this.registerCommand('teardown');
  this.registerCommand('add_authorized_keys');

  this.addListener('command', this.onCommand);

  // config defaults
  config = self.config;
  config.externalLink   = config.external_link    || 'e1000g0';
  config.internalLink   = config.internal_link    || 'e1000g2';

  config.zonesZpool     = config.zones_zpool      || 'zones';
  config.zonesZpoolPath = config.zones_zpool_path || path.join('/', config.zonesZpool);

  config.maxConcurrentProvisions = config.max_concurrent_provisions || 4;

  config.default_public_vlan_id  = config.default_public_vlan_id  || '0';
  config.default_private_vlan_id = config.default_private_vlan_id || '0';
}

sys.inherits(ProvisionerAgent, AMQPAgent);

REQUIRED_KEYS = [ 'zonename'
                , 'hostname'
//                 , 'public_ip'
//                 , 'public_vlan_id'
//                 , 'private_vlan_id'
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
  return path.join('/', this.config.zonesZpool, env.zonename);
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
    case 'add_authorized_keys':
      self.addAuthorizedKeys(msg);
      break;
  }
}

ProvisionerAgent.prototype.addAuthorizedKeys = function (msg) {
  var self = this;
  if (!msg.data) {
    return self.ackError(msg.id, 'Message missing data field');
  }

  if (!msg.data.authorized_keys) {
    return self.ackError(msg.id, 'Message missing data.authorized_keys field');
  }

  if (!msg.data.zonename) {
    return self.ackError(msg.id, 'Missing data.zonename message field');
  }
  var thePath
    = path.join(self.config.zonesZpoolPath
              , msg.data.zonename
              , 'root/home/node/.ssh/authorized_keys')

  appendToFile(
      thePath
    , "\n" + msg.data.authorized_keys
    , function (error) {
        if (error) {
          return self.ackError(msg.id, 'Error writing authorized_keys file: ' + error.toString());
        }
        return self.ackSuccess(msg.id);
      });
}

appendToFile = function (filename, content, callback) {
  fs.open(filename, 'a', 0666, function (error, fd) {
    if (error) {
      return callback(error.toString());
    }

    fs.write(fd, content, null, 'utf8', function (error) {
      if (error) {
        return callback(error.toString());
      }

      fs.close(fd, function (error) {
        if (error) {
          return callback(error.toString());
        }
        callback();
      });
    });
  });
}

ProvisionerAgent.prototype.teardown = function (msg) {
  var self = this;
  var ENV = keysToUpper(msg.data);

  execFile(path.join(__dirname, '..', 'scripts', 'teardown.sh')
    , []
    , { env: ENV }
    , function (error, stdout, stderr) {
        if (error) {
          self.provisionerEvent('error' , msg.data.zonename , stderr);
          return;
        }
        puts('Ran teardown script, and it was ok.');
        self.ackSuccess(msg.id);
        self.provisionerEvent('zone_destroyed', msg.data.zonename);
      });
}

// Create a zone when given a few values
ProvisionerAgent.prototype.provision = function (msg) {
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
  env.public_interface  = env.zonename + '0';
  env.private_interface = env.zonename + '2';

  env.public_ip     = env.public_ip  || '';
  env.private_ip    = env.private_ip || '';

  env.public_vlan_id  = env.public_vlan_id  || self.config.default_public_vlan_id;
  env.private_vlan_id = env.private_vlan_id || self.config.default_private_vlan_id;

  // This is the name of the physical links in the global zone over which we
  // will build our internal zone vnics over.
  env.external_link = self.config.externalLink;
  env.internal_link = self.config.internalLink;

  env.zpool_name    = self.config.zonesZpool;
  env.zpool_path    = self.config.zonesZpoolPath;

  var cb_count = 2;

  function _cb (error) {
    if (error) {
      self.ackError(self.msg.id, error.toString());
      return;
    }

    if (!--cb_count) {
      puts('Created configuration');

      // After this point, the agent will continue to handle new AMQP
      // requests. Because of this, we musn't modify any member variables
      // or depend on ones that will change (such as self.msg, etc).
      // Also past this point, if we wish to communicate back with the client,
      // we should use the provisionEvent method rather than
      // ackSuccess/ackFailure.
      self.ackSuccess(self.msg.id);
      delete self.msg;

      self.addToProvisionQueue(env);
    }
  }

  self.configureZone(env, _cb);
  self.configureZFS(env,  _cb);
}

ProvisionerAgent.prototype.configureZFS = function (env, callback) {
  var zfsPath = path.join(__dirname, '..', 'scripts', 'zfs.sh');
  var ENV = keysToUpper(env);
  execFile(zfsPath
  , []
  , { env: ENV }
  , function (error, stdout, stderr) {
      if (error) {
        callback(stderr);
        return;
      }
      puts('Ran zfs script, and it was ok.');
      callback();
    });
}

// Write out the two global zone configuration files
ProvisionerAgent.prototype.configureZone = function (env, callback) {
  var self = this;

  var count = 2;

  function _cb (error) {
    if (error) {
      self.ackError(self.msg.id, error);
      return;
    }

    if (!--count) {
      puts('Configured zone and it was ok');
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
  var zoneConfigPath = path.join('/etc/zones', env.zonename + '.xml');

  if (path.exists(zoneConfigPath)) {
    self.ackError(self.msg.id,
      'Zone configuration file, ' + zoneConfigPath + ' already exists');
    return;
  }

  if (!self.zoneXMLTemplate) {
    fs.readFile(ZONE_TEMPLATE_PATH, function (error, data) {
      if (error) {
        callback('Error reading ' + ZONE_TEMPLATE_PATH + ': '
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
  fs.open('/etc/zones/index', 'a', 0666, function (error, fd) {
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

ProvisionerAgent.prototype.addToProvisionQueue = function (env) {
  var self = this;
  self.provisionQueue.push(env);
  self.dispatch();
}

ProvisionerAgent.prototype.dispatch = function () {
  var self = this;

  // Try to provision as many zones as we can given our the number of zones
  // being currently provisioned and the maximum number of concurrent zone
  // provisions.
  for (; self.provisionCount < self.config.maxConcurrentProvisions
         && self.provisionQueue.length
       ; self.provisionCount++) {
    var env = self.provisionQueue.shift();
    self.runProvisionScript(env, function (error) {
      self.provisionCount--;

      if (error) {
        return;
      }

      self.dispatch();
    });
  }
}

// Run the provision shell script that does all the zone configuration that
// needs to happen at the global zone level.
ProvisionerAgent.prototype.runProvisionScript = function (env, callback) {
  var self = this;

  var ENV = keysToUpper(env);
  var keys = Object.keys(ENV);
  var i = keys.length;

  var zoneConfig = '';

  while (i--) {
    if (['authorized_keys'].indexOf(keys[i]) !== -1) {
      continue;
    }
    zoneConfig += keys[i];
    zoneConfig += '="' + String(ENV[keys[i]]).replace("\\","\\\\")
                                             .replace("\"","\\\"") + "\"" + "\n";
  }

  ENV.ZONECONFIG = zoneConfig;

  var provPath = path.join(__dirname, '..', 'scripts', 'provision.sh');
  execFile(provPath
  , []
  , { env: ENV }
  , function (error, stdout, stderr) {
      if (error) {
        self.provisionerEvent('error', env.zonename, stderr);
        return;
      }
      self.provisionerEvent('zone_created', env.zonename);

      puts('Ran provision script, and it was ok.');
      var logs = {
        provision_sh: { stdout: stdout, stderr: stderr }
      } ;

      self.followZoneinitServiceLog(env, logs, callback);
    });
}

// Read the zone's /var/log/zoninit.log
ProvisionerAgent.prototype.readZoneinitLog = function (env, callback) {
  var self = this;
  var logPath = path.join(self.zonePath(env), 'root/var/log/zoneinit.log');

  puts('Reading ' + logPath);
  fs.readFile(logPath, function (error, data) {
    if (error) {
      self.provisionerEvent('error', env.zonename, 'Error reading ' + logPath + ': ' + error.toString());
      callback(error);
      return;
    }
    callback(null, data);
  });
}

// Follow (with tail -f) the booting zone's
// /var/svc/log/system-zoneinit:default.log file and run the callback when
// completed.
ProvisionerAgent.prototype.followZoneinitServiceLog = function (env, logs, callback) {
  var self = this;

  // Create a file stream and then watch for exit
  var logPath = path.join(self.zonePath(env),
      'root/var/svc/log/system-zoneinit:default.log');

  puts('Watching ' + logPath);
  fs.watchFile(logPath, { interval: 500 }, function (curr, prev) {
    if (curr.mtime == prev.mtime)  {
      puts("Log file mtime hasn't changed\n");
      return;
    }
    puts("Log file has changed, checking...\n");

    fs.readFile(logPath, function (error, data) {
      // This file may come and go as it's deleted and recreated by the
      // zoneinit script, we need to be tolerant of that. If we get an error
      // reading the file, just skip reading it this time around.
      if (error) return;

      var found = data.toString().split("\n").some(function (line) {
        return /Method "start" exited/.test(line);
      });

      if (found) {
        self.readZoneinitLog(env, function (error, log) {
          var logs = {};
          // fire event here
          logs.zoneinit_log = log.toString();
          self.provisionerEvent('zone_ready', env.zonename, { logs: logs });
          fs.unwatchFile(logPath);
          callback(null);
        });
        return;
      }
    });
  });
};
