fs    = require('fs');
sys   = require('sys');
path  = require('path');
ejs   = require('./ejs');

constants = process.binding("natives").constants ? require("constants") : process;

ZONE_ZFS_PROPERTY_PREFIX = 'smartdc.zone';

spawn = require('child_process').spawn;
execFile = require('child_process').execFile;

AMQPAgent = require('amqp_agent/agent').AMQPAgent;
AgentClient = require('amqp_agent/client').Client

async = require('async');
zfs = require('zfs').zfs;
smartconfig = require('smartdc-config');


/**
 * Constructor
 *
 * @param {String} config
 */

exports.ProvisionerAgent = ProvisionerAgent = function (config) {
  var self = this;

  config = config || {};
  config.amqp = config.amqp || {};
  config.resource = 'provisioner';

  this.debug = config.debug;

  AMQPAgent.call(this, config);

  self.createLogger('provision', 'ProvisionerAgent');

  this.provisionCount = 0;

  this.initializeCommands();

  this.addListener('command', this.onCommand);

  // config defaults
  config = self.config;

  config.zonesZpool     = config.zones_zpool      || 'zones';
  config.zonesZpoolPath = config.zones_zpool_path || path.join('/', config.zonesZpool);

  config.maxConcurrentProvisions = config.max_concurrent_provisions || 4;
  config.fetchMissingDatasets = (config.fetch_missing_datasets === undefined) ? config.fetch_missing_datasets : true;
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


/**
 * Extend
 */

function extend (base, overlay) {
  var obj = new Object(base);
  var props = Object.getOwnPropertyNames(overlay);
  var dest = this;
  props.forEach(function(name) {
    obj[name] = overlay[name];
  });
  return obj;
}


/**
 * Register commands to be handled by the provisioner
 */

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


/**
 * Converts "hello" to "HELLO"
 */

function keysToUpper (obj) {
  var OBJ = {};
  var keys = Object.keys(obj);
  var i = keys.length;
  while (i--) {
    OBJ[keys[i].toUpperCase()] = obj[keys[i]];
  }
  return OBJ;
}


/**
 * Returns ZFS Storage Pool path
 */

ProvisionerAgent.prototype.zonePath = function (env) {
  return path.join('/', this.config.zonesZpool, env.zonename);
}


/**
 * Stop Shifting
 */

ProvisionerAgent.prototype.stopShifting = function () {
  this.config.reconnect = false;
  AMQPAgent.prototype.stopShifting.call(this);
}


/**
 * Tests if it is done provisioning
 */

ProvisionerAgent.prototype.isDone = function () {
  return (    this.provisionCount == 0
           && AMQPAgent.prototype.isDone.call(this)
         );
}


/**
 * Publishes a new provisioner event to the AMQP queue
 */

ProvisionerAgent.prototype.provisionerEvent = function ( eventType
                                                       , zonename
                                                       , req_id
                                                       , msg
                                                       ) {
  var self = this;
  if (eventType == 'error' && Object.prototype.toString.call(msg) === '[object String]') {
    msg = { error: msg }
  }

  var routing_key = [ self.config.resource
                    , 'event'
                    , eventType
                    , self.uuid
                    , zonename
                    , req_id
                    ].join(".");
  msg = msg || {};
  console.log("Publishing event to routing key: " + routing_key);
  console.dir(msg);
  self.exchange.publish(routing_key, msg);
}


/**
 * Callback that gets called when a new command from the queue arrives
 */

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


/**
 * After we create the XML file for a zone, we will push the provision request
 * for that zone into a new queue. This will allow us to process requests in
 * the main command queue quickly, while at the same time allowing a certain
 * number of provision requests to happen in the "background".
 */

ProvisionerAgent.prototype.setupProvisionQueue = function () {
  var self = this;
  console.log("Setting up provision queue");

  self.provisionQueue
    = self.connection.queue
      ( self.config.resource + '-provisions.' + self.uuid, { autoDelete: true });

  self.provisionQueue.subscribeJSON({ ack: true }, function (msg) {
    console.log("Handle Provision");
    console.dir(msg);
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


/**
 * Adds authorized keys to zone
 */

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

/**
 * Sets zone properties in the ZFS Dataset
 */

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
    console.log("Networks: " + sys.inspect(networks));
    var public_network = networks[0];
    var private_network = networks[1] || '';

    if (public_network) {
      console.log("Public network: " + sys.inspect(public_network));
      env.public_ip         = public_network.ip || '';
      env.public_interface  = 'v' + public_network.mac.replace(/:/g, '_') + '_0';
      env.public_netmask    = public_network.netmask;
      env.public_vlan_id    = public_network.vlan_id;
      env.public_nic        = public_network.interface;
      env.public_mac        = public_network.mac;
      if (public_network.blocked_ports && public_network.blocked_ports["outgoing"]) {
        env.public_blocked_outgoing_ports = public_network.blocked_ports["outgoing"];
      }
    }
    if (private_network) {
      console.log("Private network: " + sys.inspect(private_network));
      env.private_ip        = private_network.ip || '';
      env.private_interface = 'v' + private_network.mac.replace(/:/g, '_')+ '_0';
      env.private_netmask   = private_network.netmask;
      env.private_vlan_id   = private_network.vlan_id;
      env.private_nic       = private_network.interface;
      env.private_mac       = private_network.mac;
      if (private_network.blocked_ports && private_network.blocked_ports["outgoing"]) {
        env.private_blocked_outgoing_ports = private_network.blocked_ports["outgoing"];
      }
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

  self.writeZoneXML(env, function (error) {
    if (error) {
      self.ackError(self.msg.id, error);
      return;
    }

    console.log('Configured zone and it was ok');
    callback();
  });
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

// Pushes a provision request onto the secondary provisoin queue, so we can do
// them in parallel in the background.
ProvisionerAgent.prototype.addToProvisionQueue = function (env) {
  var self = this;
  console.log("Adding message to provision queue");
  self.exchange.publish
    ( [ self.config.resource + '-' + 'provisions'
      , self.uuid
      ].join(".")
    , { data: env }
    );
}

// Receive one provision message from the dedicated provision queue of
// zones waiting to be booted and zoneinit'd. We'll keep track of the number of
// provisions we have happening concurrently and prevent ourselves from
// receiving too many requests.
ProvisionerAgent.prototype.handleProvision = function (msg) {
  var self = this;
  self.shifting = false;

  self.log.provision.info("Attempting to provision");

  self.provisionCount++;

  self.provisionZone(msg.data, function (error) {
    provisionCallback(msg.data, error);
    if (!self.shifting) {
      self.shifting = true;
      console.log("Shifting!");
      self.provisionQueue.shift();
    }
  });

  // Returns whether we should do a queue.shift() and get a new message. This
  // should only be done if we don't have the maximum number of provisions
  // happening now, if we haven't been told to shutdown and if we're not
  // already shifting.
  function shouldShift () {
    var shift = (    !self.shifting
                  && !self.gracefulStop
                  && self.provisionCount < self.config.maxConcurrentProvisions
                );
    console.log("Suggesting shift be " + shift + sys.inspect([self.shifting, self.gracefulStop, self.provisionCount ]));
    return shift;
  }

  if (shouldShift()) {
    self.shifting = true;
    console.log("Shifting!");
    self.provisionQueue.shift();
  }

  function provisionCallback (env, error) {
    self.provisionCount--;

    if (error) {
      self.provisionerEvent('error', env.zonename, env.id, error.toString());
    }

    if (shouldShift()) {
      self.shifting = true;
      console.log("Shifting!");
      self.provisionQueue.shift();
    }
  }
}

// Run the provision shell script that does all the zone configuration that
// needs to happen at the global zone level.
ProvisionerAgent.prototype.provisionZone = function (env, provisionCallback) {
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

  var provisionLogs = {};

  // Do a few things one after another:
  // - get requested dataset
  // - data dataset exists
  // - send a receive_url (if_missing: true)
  // - run the provision script (scripts/provision.sh)
  // - watch the new zone's zoneinit log
  // - reply with error/success depending on outcome
  async.waterfall
    ( [ function (callback) {
          self.fetchDatasetIfMissing(env.zone_template, callback)
        }
      , function (callback) {
          self.runProvisionScript(env, ENV, callback);
        }
      , function (provisionLog, callback) {
          provisionLogs.provision_sh = provisionLog;
          self.followZoneinitServiceLog(env, callback);
        }
      , function (zoneinitLog, callback) {
          provisionLogs.zoneinit_log = zoneinitLog;
          console.log("ALmost done");
          callback(null);
        }
      ]
    , function (error) {
        if (error)
          return provisionCallback(error);

        self.provisionerEvent
          ( 'zone_ready'
          , env.zonename
          , env.id
          , { logs: provisionLogs }
          );
        provisionCallback(null);
      }
    );
}

// Callsback with an agent handle we can use to send commands to other agents.
ProvisionerAgent.prototype.getLocalAgentHandle = function (type, callback) {
  var self = this;

  // Return an existing handle if available.
  if (self.agentHandles && self.agentHandles[type]) {
    return callback(null, self.agentHandles[type]);
  }

  if (!self.agentClient) {
    var config = { timeout: 300000 };
    self.agentClient = new AgentClient(config);
    self.agentClient.useConnection(self.connection, function () {
      setupHandles();
    });
  }

  setupHandles();

  function setupHandles () {
    self.agentClient.getAgentHandle(self.uuid, type, function (handle) {
      if (!self.agentHandles) self.agentHandles = {};
      self.agentHandles[type] = handle;
      callback(null, handle);
    });
  }
}

ProvisionerAgent.prototype.fetchDatasetIfMissing = function (dataset, callback) {
  var self = this;
  var url = 'http://'+self.sdcConfig['assets_admin_ip'] +'/datasets/' + dataset + '.zfs.bz2';
  console.log("Checking whether " + dataset + " exists on the system");

  zfs.list(self.config.zonesZpool + '/' + dataset, function (error, fields, list) {
    if (!error && list.length) {
      console.log(dataset + " exists.");
      callback();
    }
    else {
      console.log(dataset + " does NOT yet exist.");
      // Dataset is missing, so we'll send a message to the dataset-manager
      // agent to zfs receive it from the assets zone.
      console.log("Fetching " + dataset + " from " + url);
      self.getLocalAgentHandle('dataset', function (error, dsmanager) {
        dsmanager.sendCommand
          ( 'receive_url'
          , { filesystem: self.zonesZpool, url: url, if_missing: dataset }
          , function (reply) {
              if (reply.error) {
                return callback(error);
              }
              callback();
            }
          );
      });
    }
  });
}

ProvisionerAgent.prototype.runProvisionScript = function (env, ENV, callback) {
  var self = this;
  var scriptPath = path.join(__dirname, '..', 'scripts', 'provision.sh');

  // If we get a test flag, deliberately make the request time out by not
  // responding.
  if (env.__test_zoneinit_timeout_error) {
    console.log("Deliberately timing out");
    self.provisionerEvent('zone_created', env.zonename, env.id);
    return callback(null, {});
  }

  execFile
    ( scriptPath
    , []
    , { env: extend(process.env, ENV) }
    , function (error, stdout, stderr) {
        if (error) {
          callback(new Error(stderr.toString()));
          return;
        }
        self.provisionerEvent('zone_created', env.zonename, env.id);

        self.log.provision.info('Provision Script Output:');
        self.log.provision.info("STDOUT:\n" + stdout);
        self.log.provision.info("STDERR:\n" + stderr);

        var logs = { stdout: stdout, stderr: stderr };

        return callback(null, logs);
      }
    );
}

// Read the zone's /var/log/zoneinit.log
ProvisionerAgent.prototype.readZoneinitLog = function (env, callback) {
  var self = this;

  var logPath = path.join(self.zonePath(env), 'root/var/log/zoneinit.log');
  self.log.provision.info('Reading ' + logPath);

  fs.readFile(logPath, function (error, data) {
    if (error) {
      callback(new Error('Error reading ' + logPath + ': ' + error.toString()));
      return;
    }
    callback(null, data.toString());
  });
}

// Watch (by repeatedly stat'ing the file) the booting zone's
// /var/svc/log/system-zoneinit:default.log file and run the callback when
// we see the zoneinit service has exited.
ProvisionerAgent.prototype.followZoneinitServiceLog = function (env, callback) {
  var self = this;

  // Create a file stream and then watch for exit
  var logPath = path.join(self.zonePath(env),
      'root/var/svc/log/system-zoneinit:default.log');

  // Start checking the log file. If it hasn't been updated before the
  // timeout, we should check it one last time and then fail?
  var timeoutAfterSeconds
    = (    env.zoneinit_timeout
        || self.config.zoneinit_timeout
        || 600
      );

  console.log("Timing provision out after " + timeoutAfterSeconds + " seconds.");
  var timeout = setTimeout(onTimeout, timeoutAfterSeconds * 1000);

  self.log.provision.info('Watching ' + logPath);

  fs.watchFile(logPath, { interval: 1000 }, function (curr, prev) {
    if (curr.mtime == prev.mtime)  {
      self.log.provision.error("Log file mtime hasn't changed\n");
      return;
    }
    self.log.provision.info("Log file for zone '" + env.zonename + "' has changed. Checking...");

    // `log` will be set if we succeeded.
    checkLogfile(function (error, found, log) {
      // fire event here
      if (found) {
        console.log("ALL GOOD");
        callback(null, log);
      }
    });
  });

  // If we time out watching the log file, check one more time and fail if we
  // are still unsatisfied.
  function onTimeout() {
    console.log("Provision timedout, checking log file one last time");
    fs.unwatchFile(logPath);
    checkLogfile(function (error, found, log) {
      if (!found) {
        callback
          ( new Error
            ( "Timed out after waiting "
              + timeoutAfterSeconds + " seconds for "
              + logPath + " to indicate success."
            )
          );
        return;
      }
      else {
        callback(null, log);
        return;
      }
    });
  }

  // Checks if the svc log file for zoneinit has indicated that the start
  // method has completed.
  function checkLogfile (cb) {
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
        console.log("Found it");
        clearTimeout(timeout);
        fs.unwatchFile(logPath);

        self.readZoneinitLog(env, function (error, log) {
          console.dir(arguments);
          if (error) {
            return cb(error);
          }
          return cb(null, found, log);
        });
        return;
      }
      else {
        // Didn't find any indication of success
        return cb();
      }
    });
  }
};
