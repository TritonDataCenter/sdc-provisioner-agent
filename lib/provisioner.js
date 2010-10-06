path = require('path');
require.paths.unshift(path.join(__dirname, '..', 'lib'));

fs    = require('fs');
sys   = require('sys');
path  = require('path');
ejs   = require('ejs');

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

  this.initializeCommands();

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
//                 , 'inherited_directories'
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

ProvisionerAgent.prototype.initializeCommands = function (env) {
  var self = this;
  var commands
    = [ 'provision'
      , 'teardown'
      , 'activate'
      , 'deactivate'
      , 'reboot'
      , 'resize'
      , 'add_authorized_keys'
      ];

  commands.forEach(function (command) {
    self.registerCommand(command);
  });
}

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
                                   = function (eventType, zonename, req_id, msg) {
  var self = this;

  var routing_key = [self.config.resource, 'event', eventType
                    , self.hostname, zonename, req_id].join(".");
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

  self[command].call(self, msg);
}

ProvisionerAgent.prototype.addAuthorizedKeys = function (msg) {
  var self = this;
  var errorMsg;

  if (!msg.data.authorized_keys) {
    errorMsg = 'Message missing data.authorized_keys field'
    self.provisionerEvent('error', msg.data.zonename, msg.id, errorMsg);
    self.ackError(msg.id, errorMsg);
    return;
  }

  if (!msg.data.zonename) {
    errorMsg = 'Missing data.zonename message field';
    self.provisionerEvent('error', msg.data.zonename, msg.id, errorMsg);
    self.ackError(msg.id, errorMsg);
    return;
  }
  var thePath
    = path.join(self.config.zonesZpoolPath
              , msg.data.zonename
              , 'root/home/node/.ssh/authorized_keys')

  var fun = msg.data.overwrite ? overwriteFile : appendFile;

  fun
    ( thePath
    , ( msg.data.overwrite ? "" : "\n" )
      + msg.data.authorized_keys
    , function (error) {
        if (error) {
          var errorMsg = 'Error writing authorized_keys file: ' + error.toString();
          self.ackError(msg.id, errorMsg);
          self.provisionerEvent('error', msg.data.zonename, msg.id, error.toString());
          return;
        }
        self.ackSuccess(msg.id);
        self.provisionerEvent('ssh_keys_added', msg.data.zonename, msg.id);
        return;
      });
}

function writeAndCloseFD (fd, content, callback) {
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
}

function appendFile(filename, content, callback) {
  fs.open(filename, 'a', 0666, function (error, fd) {
    if (error) {
      return callback(error);
    }
    writeAndCloseFD(fd, content, callback);
  });
}

function overwriteFile(filename, content, callback) {
  fs.open(filename, 'w', 0666, function (error, fd) {
    if (error) {
      return callback(error);
    }
    writeAndCloseFD(fd, content, callback);
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
          self.provisionerEvent('error', msg.data.zonename, msg.id, stderr);
          self.ackError(msg.id, stderr.toString());
          return;
        }
        puts('Ran teardown script, and it was ok.');
        self.ackSuccess(msg.id);
        self.provisionerEvent('zone_destroyed', msg.data.zonename, msg.id);
      });
}

ProvisionerAgent.prototype.activate = function (msg) {
  var self = this;
  var ENV = keysToUpper(msg.data);

  execFile(path.join(__dirname, '..', 'scripts', 'activate.sh')
    , []
    , { env: ENV }
    , function (error, stdout, stderr) {
        if (error) {
          self.provisionerEvent('error', msg.data.zonename, msg.id, stderr.toString());
          self.ackError(msg.id, stderr.toString());
          return;
        }
        puts('Ran activate script, and it was ok.');
        self.ackSuccess(msg.id);
        self.provisionerEvent('zone_activated', msg.data.zonename, msg.id);
      });
}

ProvisionerAgent.prototype.deactivate = function (msg) {
  var self = this;
  var ENV = keysToUpper(msg.data);

  execFile(path.join(__dirname, '..', 'scripts', 'deactivate.sh')
    , []
    , { env: ENV }
    , function (error, stdout, stderr) {
        if (error) {
          self.provisionerEvent('error', msg.data.zonename, msg.id, stderr);
          self.ackError(msg.id, stderr.toString());
          return;
        }
        puts('Ran deactivate script, and it was ok.');
        self.ackSuccess(msg.id);
        self.provisionerEvent('zone_deactivated', msg.data.zonename, msg.id);
      });
}

ProvisionerAgent.prototype.reboot = function (msg) {
  var self = this;
  var ENV = keysToUpper(msg.data);

  execFile(path.join(__dirname, '..', 'scripts', 'reboot.sh')
    , []
    , { env: ENV }
    , function (error, stdout, stderr) {
        if (error) {
          self.provisionerEvent('error', msg.data.zonename, msg.id, stderr);
          self.ackError(msg.id, stderr.toString());
          return;
        }
        puts('Ran reboot script, and it was ok.');
        self.ackSuccess(msg.id);
        self.provisionerEvent('zone_rebooted', msg.data.zonename, msg.id);
      });
}

ProvisionerAgent.prototype.resize = function (msg) {
  var self = this;
  var ENV = keysToUpper(msg.data);

  ENV['ZPOOL_NAME'] = self.config.zonesZpool;

  execFile(path.join(__dirname, '..', 'scripts', 'resize.sh')
    , []
    , { env: ENV }
    , function (error, stdout, stderr) {
        if (error) {
          self.provisionerEvent('error', msg.data.zonename, msg.id, stderr);
          self.ackError(msg.id, stderr.toString());
          return;
        }
        puts('Ran resize script, and it was ok.');
        self.ackSuccess(msg.id);
        self.provisionerEvent('zone_resized', msg.data.zonename, msg.id);
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
  env.id  = msg.id;

  // vnic-links can't have - in them.
  var link = env.zonename.replace(/-/g, '_');

  // These are the names of the two interfaces inside the zone.
  env.public_interface  = link + '0';
  env.private_interface = link + '2';

  env.public_ip     = env.public_ip  || '';
  env.private_ip    = env.private_ip || '';

  env.public_vlan_id  = env.public_vlan_id  || self.config.default_public_vlan_id;
  env.private_vlan_id = env.private_vlan_id || self.config.default_private_vlan_id;

  env.inherited_directories = env.inherited_directories
                              ? env.inherited_directories.split(':')
                              : [];

  // This is the name of the physical links in the global zone over which we
  // will build our internal zone vnics over.
  env.external_link = self.config.externalLink;
  env.internal_link = self.config.internalLink;

  env.zpool_name    = self.config.zonesZpool;
  env.zpool_path    = self.config.zonesZpoolPath;

  env.baseOS_vers   = self.baseOS_vers;

  function _cb (error) {
    if (error) {
      self.ackError(self.msg.id, error.toString());
      return;
    }

    puts('Created configuration');

    // After this point, the agent will continue to handle new AMQP
    // requests. Because of this, we musn't modify any member variables
    // or depend on ones that will change (such as self.msg, etc).
    // Also past this point, if we wish to communicate back with the client,
    // we should use the provisionerEvent method rather than
    // ackSuccess/ackFailure.
    self.ackSuccess(self.msg.id);
    delete self.msg;

    self.addToProvisionQueue(env);
  }

  self.configureZone(env, _cb);
}

// Write out either one or two global zone configuration files
ProvisionerAgent.prototype.configureZone = function (env, callback) {
  var self = this;

  function _cb (error) {
    if (error) {
      self.ackError(self.msg.id, error);
      return;
    }

    puts('Configured zone and it was ok');
    callback();
  }

  self.writeZoneXML(env, _cb);
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
    fs.readFile(self.zone_template_path, function (error, data) {
      if (error) {
        callback('Error reading ' + self.zone_template_path + ': '
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
        self.provisionerEvent('error', env.zonename, env.id, error.toString());
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
  if (!env.__test_zoneinit_timeout_error) {
    execFile
      ( provPath
      , []
      , { env: ENV }
      , function (error, stdout, stderr) {
          if (error) {
            callback(new Error(stderr.toString()));
            return;
          }
          self.provisionerEvent('zone_created', env.zonename, env.id);

          puts('Ran provision script, and it was ok.');
          var logs = {
            provision_sh: { stdout: stdout, stderr: stderr }
          } ;

          self.followZoneinitServiceLog(env, logs, callback);
        });
  }
  else {
    self.provisionerEvent('zone_created', env.zonename, env.id);
    self.followZoneinitServiceLog(env, {}, callback);
  }
}

// Read the zone's /var/log/zoninit.log
ProvisionerAgent.prototype.readZoneinitLog = function (env, callback) {
  var self = this;
  var logPath = path.join(self.zonePath(env), 'root/var/log/zoneinit.log');

  puts('Reading ' + logPath);
  fs.readFile(logPath, function (error, data) {
    if (error) {
      callback(new Error('Error reading ' + logPath + ': ' + error.toString()));
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

  // Start checking the log file. If it hasn't been updated before the
  // timeout, we should check it one last time and then fail?
  var timeoutAfter = 45000;
  var timeout = setTimeout(onTimeout, timeoutAfter);

  console.log('Watching ' + logPath);

  fs.watchFile(logPath, { interval: 500 }, function (curr, prev) {
    if (curr.mtime == prev.mtime)  {
      puts("Log file mtime hasn't changed\n");
      return;
    }
    puts("Log file has changed, checking...\n");

    // `log` will be set if we succeeded.
    checkLogfile(function (error, log) {
      var logs = {};
      // fire event here
      if (log) {
        zoneReady(log);
      }
    });
  });

  // If watching the log file has times out, check one more time and fail if
  // we are still unsatisfied.
  function onTimeout() {
    fs.unwatchFile(logPath);
    checkLogfile(function (error, log) {
      if (!log) {
        callback
          ( new Error
            ( "Timed out after waiting "
              + timeoutAfter + "ms for "
              + logPath + " to indicate success."
            )
          );
        return;
      }
      else {
        zoneReady(log);
        return;
      }
    });
  }

  // Checks if the svc log file for zoneinit has indicated that the start
  // method has completed.
  function checkLogfile(cb) {
    fs.readFile(logPath, function (error, data) {
      // This file may come and go as it's deleted and recreated by the
      // zoneinit script, we need to be tolerant of that. If we get an error
      // reading the file, just skip reading it this time around.
      if (error) return;

      var found = data.toString().split("\n").some(function (line) {
        return /Method "start" exited/.test(line);
      });

      if (found) {
        clearTimeout(timeout);
        fs.unwatchFile(logPath);

        self.readZoneinitLog(env, function (error, log) {
          if (error) {
            cb(error);
            return;
          }
          cb(undefined, log);
        });
        return;
      }
      else {
        // Didn't find any indication of success
        cb();
      }
    });
  }

  function zoneReady(log) {
    logs.zoneinit_log = log.toString();
    self.provisionerEvent
      ( 'zone_ready'
      , env.zonename
      , env.id
      , { logs: logs }
      );
    callback();
  }
};
