fs    = require('fs');
sys   = require('sys');
path  = require('path');
ejs   = require('./ejs');

constants = process.binding("natives").constants ? require("constants") : process;

ZONE_ZFS_PROPERTY_PREFIX = 'smartdc.zone';

spawn = require('child_process').spawn;
execFile = require('child_process').execFile;

console.dir(require.paths);
AMQPAgent = require('amqp_agent/agent').AMQPAgent;

exports.ProvisionerAgent = ProvisionerAgent = function (config) {
  var self = this;

  config = config || {};
  config.amqp = config.amqp || {};
  config.resource = 'provisioner';

  this.debug = config.debug;

  AMQPAgent.call(this, config);

  this.provisionCount = 0;

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
//                 , 'uuid'
//                 , 'owner_uuid'
//                 , 'charge_after'
//                 , 'zone_type'
//                 , 'zone_version'
//                 , 'admin_user'
                , 'hostname'
//                , 'networks'
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
//                 , 'zoneinit_timeout'
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
      , 'zone_properties'
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

ProvisionerAgent.prototype.isDone = function () {
  return (    this.provisionCount == 0
           && ProvisionerAgent.prototype.isDone.call(this)
         );
}

ProvisionerAgent.prototype.provisionerEvent = function ( eventType
                                                       , zonename
                                                       , req_id
                                                       , msg
                                                       ) {
  var self = this;
  if (eventType == 'error' && Object.prototype.toString.call(msg) === '[object String]') {
    msg = { data: msg }
  }

  var routing_key = [ self.config.resource
                    , 'event'
                    , eventType
                    , self.uuid
                    , zonename
                    , req_id
                    ].join(".");
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

  msg.data.zpool_name = self.config.zonesZpool;
  msg.data.zpool_path = self.config.zonesZpoolPath;
  msg.data.zone_zfs_property_prefix = ZONE_ZFS_PROPERTY_PREFIX;

  var env = self.env = new Object(msg.data);

  self.msg = msg;
  self.start = Date.now();

  self[command].call(self, msg);
}

// After we create the XML file for a zone, we will push the provision request
// for that zone into a new queue. This will allow us to process requests in
// the main command queue quickly, while at the same time allowing a certain
// number of provision requests to happen in the "background".
ProvisionerAgent.prototype.setupProvisionQueue = function () {
  var self = this;

  self.provisionQueue
    = self.connection.queue
      ( self.config.resource + '-provisions.' + self.uuid
      , { durable: true
        , autoDelete: false
        });

  self.provisionQueue.subscribeJSON({ ack: true }, function (msg) {
    console.log("Handle Provision");
    self.handleProvision(msg);
  });

  self.provisionQueue.bind
    ( [ self.config.resource + '-' + 'provisions'
      , self.uuid
      ].join('.')
    );
}

function getFileOwner(filename, callback) {
  fs.stat(filename, function (error, stat) {
    if (error) return callback(error);
    callback(undefined, [stat.uid, stat.gid]);
  });
}

function isString (obj) {
  return Object.prototype.toString.call(obj) === '[object String]';
}

function isArray (obj) { return Array.isArray(obj) }

function userExists (username, passwdFile, callback) {
  fs.readFile(passwdFile, function (error, data) {
    if (error) {
      callback("Couldn't read " + passwdFile + ": " + error.toString());
      return;
    }
    var parts;
    callback
      ( undefined
      , data.toString().trim().split("\n").some(function (line) {
          parts = line.split(':');
          return parts[0] === username;
        })
      );
  });
}

ProvisionerAgent.prototype.add_authorized_keys = function (msg) {
  var self = this;
  var errorMsg;

  if (!msg.data.overwrite && !msg.data.authorized_keys) {
    errorMsg = 'Message missing data.authorized_keys field'
    self.provisionerEvent('error', msg.data.zonename, msg.id, errorMsg);
    self.ackError(msg.id, errorMsg);
    return;
  }

  if (!msg.data.user) {
    errorMsg = 'Message missing data.user field'
    self.provisionerEvent('error', msg.data.zonename, msg.id, errorMsg);
    self.ackError(msg.id, errorMsg);
    return;
  }

  if (/[^-a-zA-Z0-9_\.]/.exec(msg.data.user)) {
    errorMsg = 'Invalid characters found in username'
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

  var username = msg.data.user;

  var zonePath = path.join(self.config.zonesZpoolPath, msg.data.zonename, 'root');
  var homePath = path.join(zonePath, 'home', username);
  var thePath  = path.join(homePath, '.ssh/authorized_keys');

  userExists
    ( username
    , path.join(zonePath,  '/etc/passwd')
    , function (error, exists) {
        if (error) {
          errorMsg = 'Error checking if ' + username + " existed.";
          self.provisionerEvent('error', msg.data.zonename, msg.id, errorMsg);
          self.ackError(msg.id, errorMsg);
          return;
        }

        if (exists) {
          path.exists(thePath, function (exists) {
            if (exists) {
              verifyFileOwnership();
            }
            else {
              writeKeysFile();
            }
          });
        }
        else {
          errorMsg = 'No such user: ' + username
          self.provisionerEvent('error', msg.data.zonename, msg.id, errorMsg);
          self.ackError(msg.id, errorMsg);
          return;
        }
      }
    );


  function verifyFileOwnership() {
    getFileOwner(thePath, function (error, keysOwner) {
      var errorMsg = "Error looking up authorized_keys permissions: ";
      if (error) {
        self.ackError(msg.id, errorMsg + error.toString());
        return;
      }
      getFileOwner(homePath, function (error, homeOwner) { 
        if (error) {
          self.ackError(msg.id, errorMsg + error.toString());
          return;
        }
        var keysStr = keysOwner.join('/');
        var homeStr = homeOwner.join('/');

        if (keysStr !== homeStr) {
          var errorMsg
            = "authorized_keys owner did not match home directory owner";
          self.ackError(msg.id, errorMsg);
          return;
        }

        verifyPlainFile();
      });
    });
  }

  function verifyPlainFile() {
    var ENOENT = 2;
    var errorMsg;

    fs.realpath(thePath, function (error, realPath) {
      if (error) {
          errorMsg
            = "Error: " + error.toString();
          self.ackError(msg.id, errorMsg);
          self.provisionerEvent('error', msg.data.zonename, msg.id, errorMsg);
          return;
      }

      fs.stat(realPath, function (error, stats) {
        if (error) {
          errorMsg
            = "Error stat'ing authorized_keys: " + error.toString();
          self.ackError(msg.id, errorMsg);
          self.provisionerEvent('error', msg.data.zonename, msg.id, errorMsg);
          return;
        }

        if (!stats.isFile()) {
          errorMsg
            = "authorized_keys was not a plain file or symlink to one";
          self.ackError(msg.id, errorMsg);
          self.provisionerEvent('error', msg.data.zonename, msg.id, errorMsg);
          return;
        }

        writeKeysFile();
      });
    });
  }

  function writeKeysFile() {
    var fun
      = msg.data.overwrite
        ? overwriteAuthorizedKeys
        : appendAuthorizedKeys;

    var authorized_keys;

    if (isString(msg.data.authorized_keys)) {
      authorized_keys = msg.data.authorized_keys.split(/\n+/);
    }
    else if (isArray(msg.data.authorized_keys)) {
      authorized_keys = msg.data.authorized_keys;
    } else {
      // Can be null if overwrite==true.
      authorized_keys = [];
    }

    fun
      ( thePath
      , authorized_keys
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

  // Reads and attempts to append to the authorized_keys file any keys that
  // are not already present.
  function appendAuthorizedKeys(thePath, authorized_keys, callback) {
    var oldAuthorizedKeys;
    var keysToAdd = [];

    // Go through all the keys and write everything that isn't a duplicate.
    fs.readFile(thePath, function (error, data) {
      if (error) {
        callback(new Error("Couldn't read " + thePath + ": " + error.toString()));
        return;
      }

      data = data.toString();
      oldAuthorizedKeys = data.toString().split(/\n+/);
      var i = authorized_keys.length;

      while (i--) {
        if (oldAuthorizedKeys.indexOf(authorized_keys[i]) === -1) {
          keysToAdd.push(authorized_keys[i]);
        }
      }

      appendFile(thePath, "\n" + keysToAdd.join("\n") + "\n", callback);
    });
  }

  function overwriteAuthorizedKeys(thePath, authorized_keys, callback) {
    overwriteFile
      ( thePath
      , "\n" + authorized_keys.join("\n") + "\n"
      , callback
      );
  }
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

// Run the `file` utility on a filename, and call callback with the result.
function fileMagic(filename, callback) {
  execFile
    ( '/usr/bin/file'
    , [ filename ]
    , function (error, stdout, stderr) {
        if (error) {
          callback(error);
          return;
        }

        stdout = stdout.trim();
        var m = (new RegExp(filename + ":\\s+" + '(.*)$')).exec(stdout);
        if (!m) {
          callback(new Error("File magic error: " + stderr.trim()));
          return;
        }
        console.dir(m);

        callback(undefined, m[1]);
      });
}

ProvisionerAgent.prototype.zone_properties = function (msg) {
  var self = this;
  msg.data.owner_uuid    = msg.data.owner_uuid    || '';
  msg.data.charge_after  = msg.data.charge_after  || '';
  msg.data.zone_type     = msg.data.zone_type     || '';
  msg.data.zone_property_version = '1.0';

  var ENV = keysToUpper(msg.data);

  execFile
    ( path.join(__dirname, '..', 'scripts', 'zone_properties.sh')
    , []
    , { env: ENV }
    , function (error, stdout, stderr) {
        if (error) {
          self.provisionerEvent('error', msg.data.zonename, msg.id, stderr);
          self.ackError(msg.id, stderr.toString());
          return;
        }
        self.ackSuccess(msg.id);
        self.provisionerEvent('zone_properties_set', msg.data.zonename, msg.id);
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
        console.log('Ran teardown script, and it was ok.');
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
        console.log('Ran activate script, and it was ok.');
        self.ackSuccess(msg.id);
        self.provisionerEvent('zone_activated', msg.data.zonename, msg.id);
      });
}

ProvisionerAgent.prototype.deactivate = function (msg) {
  var self = this;
  msg.data.deleted_at = (new Date()).toISOString();
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
        console.log('Ran deactivate script, and it was ok.');
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
        console.log('Ran reboot script, and it was ok.');
        self.ackSuccess(msg.id);
        self.provisionerEvent('zone_rebooted', msg.data.zonename, msg.id);
      });
}

ProvisionerAgent.prototype.resize = function (msg) {
  var self = this;
  var ENV = keysToUpper(msg.data);

  execFile(path.join(__dirname, '..', 'scripts', 'resize.sh')
    , []
    , { env: ENV }
    , function (error, stdout, stderr) {
        if (error) {
          self.provisionerEvent('error', msg.data.zonename, msg.id, stderr);
          self.ackError(msg.id, stderr.toString());
          return;
        }
        console.log('Ran resize script, and it was ok.');
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

  if (isArray(msg.data.authorized_keys)) {
    msg.data.authorized_keys = msg.data.authorized_keys.join("\n");
  }

  var env = new Object(msg.data);
  env.id  = msg.id;

  env.owner_uuid       = env.owner_uuid    || '';
  env.charge_after     = env.charge_after  || '';
  env.zone_type        = env.zone_type     || '';
  env.zone_property_version = '1.0';
  env.uuid             = env.uuid          || '';
  env.admin_user       = env.admin_user
    || ( /^nodejs/.exec(env.zone_template) ? 'node' : 'jill' );


  // Networking variables

  // vnic-links can't have - in them.
  var link = env.zonename.replace(/-/g, '_');
  env.public_ip = '';
  env.private_ip = '';
  var networks = env.networks
  if (networks) {
    delete env.networks;
    var public_network = networks[0];
    var private_network = networks[1] || '';

    if (public_network) {
      env.public_ip         = public_network.ip || '';
      env.public_interface  = link + '0';
      env.public_netmask    = public_network.netmask;
      env.public_vlan_id    = public_network.vlan_id;
      env.public_nic        = public_network.interface;
    }
    if (private_network) {
      env.private_ip        = private_network.ip || '';
      env.private_interface = link + '2';
      env.private_netmask   = private_network.netmask;
      env.private_vlan_id   = private_network.vlan_id;
      env.private_nic       = private_network.interface;
    }
  }

  env.inherited_directories = env.inherited_directories
                              ? env.inherited_directories.split(':')
                              : [];

  // This is the name of the physical links in the global zone over which we
  // will build our internal zone vnics over.

  env.baseOS_vers   = self.baseOS_vers;

  self.configureZone(env, function (error) {
    if (error) {
      self.ackError(self.msg.id, error.toString());
      return;
    }

    console.log('Created configuration');

    // After this point, the agent will continue to handle new AMQP
    // requests. Because of this, we musn't modify any member variables
    // or depend on ones that will change (such as self.msg, etc).
    // Also past this point, if we wish to communicate back with the client,
    // we should use the provisionerEvent method rather than
    // ackSuccess/ackFailure.
    self.ackSuccess(self.msg.id);
    delete self.msg;

    self.addToProvisionQueue(env);
  });
}

// Write out either one or two global zone configuration files
ProvisionerAgent.prototype.configureZone = function (env, callback) {
  var self = this;

  function _cb (error) {
    if (error) {
      self.ackError(self.msg.id, error);
      return;
    }

    console.log('Configured zone and it was ok');
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
  self.exchange.publish
    ( [ self.config.resource + '-' + 'provisions'
      , self.uuid
      ].join(".")
    , { data: env }
    );
}

// Receive one provision message from the dedicated provision queue of
// machines waiting to be booted up. We'll keep track of the number of
// provisions we have happening concurrently and prevent ourselves from
// receiving too many requests.
ProvisionerAgent.prototype.handleProvision = function (msg) {
  var self = this;

  console.log("Attempting to provision");

  self.provisionCount++;

  self.runProvisionScript(msg.data, function (error) {
    provisionCallback(msg.data, error);
  });

  if (!self.gracefulStop && self.provisionCount < self.config.maxConcurrentProvisions) {
    self.provisionQueue.shift();
  }

  function provisionCallback (env, error) {
    self.provisionCount--;

    if (error) {
      self.provisionerEvent('error', env.zonename, env.id, error.toString());
    }

    if (!self.gracefulStop && self.provisionCount < self.config.maxConcurrentProvisions) {
      self.provisionQueue.shift();
    }
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
                                             .replace("\"","\\\"") + "\"\n";
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

          console.log('Ran provision script, and it was ok.');
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

  console.log('Reading ' + logPath);
  fs.readFile(logPath, function (error, data) {
    if (error) {
      callback(new Error('Error reading ' + logPath + ': ' + error.toString()));
      return;
    }
    callback(null, data);
  });
}

// Follow (by repeatedly stat'ing the file) the booting zone's
// /var/svc/log/system-zoneinit:default.log file and run the callback when
// completed.
ProvisionerAgent.prototype.followZoneinitServiceLog = function (env, logs, callback) {
  var self = this;

  // Create a file stream and then watch for exit
  var logPath = path.join(self.zonePath(env),
      'root/var/svc/log/system-zoneinit:default.log');

  // Start checking the log file. If it hasn't been updated before the
  // timeout, we should check it one last time and then fail?
  var timeoutAfterSeconds = (   env.zoneinit_timeout
                             || self.config.zoneinit_timeout
                             || 90);
  var timeout = setTimeout(onTimeout, timeoutAfterSeconds * 1000);

  console.log('Watching ' + logPath);

  fs.watchFile(logPath, { interval: 500 }, function (curr, prev) {
    if (curr.mtime == prev.mtime)  {
      console.log("Log file mtime hasn't changed\n");
      return;
    }
    console.log("Log file for zone '" + env.zonename + "' has changed. Checking...");

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
              + timeoutAfterSeconds + "ms for "
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
      if (error) {
        return cb(error);
      };

      var found = data.toString().split("\n").some(function (line) {
        return /Method "start" exited with status \d+/.test(line);
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
