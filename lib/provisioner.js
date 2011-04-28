/**
 * Joyent Zone Provisioner Agent
 */

var fs             = require('fs')
  , sys            = require('sys')
  , path           = require('path')
  , ejs            = require('./ejs')
  , zfs            = require('zfs').zfs
  , AMQPAgent      = require('amqp_agent/agent').AMQPAgent
  , AgentClient    = require('amqp_agent/client').Client
  , ThrottledQueue = require('./throttled_queue')
  , VMADMClient    = require('./vmadm_client').Client

var ProvisionTask = require('./provision_task')
  , common = require('./common');

os = require('os')
spawn = require('child_process').spawn;
execFile = require('child_process').execFile;


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

  this.initializeCommands();

  if (os.type() == 'Linux') {
    self.vmadm = new VMADMClient(); 
    self.vmadm.connect('/tmp/vmadmd.sock', function() {
      console.log("[VMADM] Connected")
    });
  }

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
//                 , 'dataset_url_path'
                , 'hostname'
                , 'networks'
//                 , 'no_networks'
//                 , 'public_ip'
//                 , 'public_vlan_id'
//                 , 'private_vlan_id'
//                 , 'new_ip'
//                 , 'private_ip'
//                 , 'inherited_directories'
//                 , 'vs_pw'
//                 , 'root_pw'
//                 , 'admin_pw'
//                , 'zone_template'
//                , 'template_version'
//                , 'tmpfs'
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

  if (os.type() == 'Linux') {
    var commands
    = [ 'hvm_boot'
      , 'hvm_create'
      , 'hvm_destroy'
      , 'hvm_reset'
      , 'hvm_halt'
      , 'hvm_kill'
    ];
  } else {
    var commands
    = [ 'provision'
      , 'teardown'
      , 'activate'
      , 'deactivate'
      , 'reboot'
      , 'resize'
      , 'add_authorized_keys'
      , 'add_nic'
      , 'remove_nic'
      , 'zone_properties'
    ];
  }

  commands.forEach(function (command) {
    self.registerCommand(command);
  });
}

/**
 * Returns ZFS Storage Pool path
 */

ProvisionerAgent.prototype.zonePath = function (env) {
  return path.join('/', this.config.zonesZpool, env.zonename);
}


/**
 * Tests if it is done provisioning
 */

ProvisionerAgent.prototype.isDone = function () {
  console.log("Current provisions: " + this.provisionQueue.msgCount);
  return (    this.provisionQueue.msgCount == 0
           && AMQPAgent.prototype.isDone.call(this)
         );
}

ProvisionerAgent.prototype.stopShifting = function () {
  this.provisionQueue.stop();
  AMQPAgent.prototype.stopShifting.call(this)
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

  var env = self.env = new Object(msg.data);

  self.msg = msg;
  self.start = Date.now();

  self[command].call(self, msg);
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
        self.provisionerEvent('error', msg.data.zonename, msg.id, error.toString());
        self.ackError(msg.id, errorMsg + error.toString());
        return;
      }
      getFileOwner(homePath, function (error, homeOwner) {
        if (error) {
          self.provisionerEvent('error', msg.data.zonename, msg.id, error.toString());
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
          self.provisionerEvent('error', msg.data.zonename, msg.id, errorMsg);
          self.ackError(msg.id, errorMsg);
          return;
        }

        if (!stats.isFile()) {
          errorMsg
            = "authorized_keys was not a plain file or symlink to one"+sys.inspect(stats);
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

  var ENV = common.keysToUpper(msg.data);

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

function teardown (msg, callback) {
  console.log("Completely destroying zone " + msg.data.zonename);
  var ENV = common.keysToUpper(msg.data);
  execFile(path.join(__dirname, '..', 'scripts', 'teardown.sh')
    , []
    , { env: ENV }
    , function (error, stdout, stderr) {
        if (error) {
          return callback(new Error(stderr.toString()));
        }
        console.log("Teardown successful.");
        callback();
      });
}

ProvisionerAgent.prototype.teardown = function (msg) {
  var self = this;

  teardown(msg, function (error) {
    if (error) {
      self.provisionerEvent('error', msg.data.zonename, msg.id, error.toString());
      self.ackError(msg.id, error.toString());
      return;
    }
    console.log('Ran teardown script, and it was ok.');
    self.ackSuccess(msg.id);
    self.provisionerEvent('zone_destroyed', msg.data.zonename, msg.id);
  });
}

ProvisionerAgent.prototype.activate = function (msg) {
  var self = this;
  var ENV = common.keysToUpper(msg.data);

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
  var ENV = common.keysToUpper(msg.data);

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
  var ENV = common.keysToUpper(msg.data);

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
  var ENV = common.keysToUpper(msg.data);

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

/**
 * Adds vnic to zone
 */

ProvisionerAgent.prototype.add_nic = function (msg) {
  var self = this;
  self.nicCommand(msg, 'add');
}

/**
 * Removes vnic from zone
 */

ProvisionerAgent.prototype.remove_nic = function (msg) {
  var self = this;
  self.nicCommand(msg, 'remove');
}

ProvisionerAgent.prototype.hvm_boot = function(msg) {
  var self = this;

  self.vmadm.action('boot', { uuid: msg.data.uuid }, function(result) {
    console.log(result);
  });
}

ProvisionerAgent.prototype.hvm_reset = function(msg) {
  var self = this;

  self.action('reset', { uuid: msg.data.uuid }, function(result) {
    console.log(result);
  });
}

ProvisionerAgent.prototype.hvm_halt = function(msg) {
  var self = this;

  self.action('halt', { uuid: msg.data.uuid }, function(result) {
    console.log(result);
  });
}

ProvisionerAgent.prototype.nicCommand = function (msg, action) {
  var self = this;
  msg.data.zone_root = '/' + self.config.zonesZpool + '/' + msg.data.zonename + '/root';
  var ENV = common.keysToUpper(msg.data);

  console.log('About to run add_vnic script, env: ' + sys.inspect(ENV));
  execFile(path.join(__dirname, '..', 'scripts', action + '_vnic.sh')
    , []
    , { env: ENV }
    , function (error, stdout, stderr) {
        if (error) {
          self.provisionerEvent('error', msg.data.zonename, msg.id,
            {
               'stderr' : stderr
              , 'mac' : msg.data.mac
            });
          self.ackError(msg.id, stderr.toString());
          return;
        }
        console.log('Ran ' + action + '_vnic script, and it was ok.');
        self.ackSuccess(msg.id);
        self.provisionerEvent('nic_' + action + '_done', msg.data.zonename, msg.id,
          {
            'mac': msg.data.mac
          });
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
  env.zfs_io_priority = env.zfs_io_priority || '100';

  // Networking variables

  env.public_ip = '';
  env.private_ip = '';

  var networks = env.networks
  if (networks && Array.isArray(networks) && networks.length > 0) {
    delete env.networks;
    console.log("Networks: " + sys.inspect(networks));

    for (var i in networks) {
      var net = networks[i];
      _addNetworkToEnv('net' + i, net, env);
      if (i == 0) {
        _addNetworkToEnv('public', net, env);
      }
      if (i == 1) {
        _addNetworkToEnv('private', net, env);
      }
    }
  }
  else {
    /**
     * Give ourselves a way of creating zones with no networks, while still
     * maintaining it an error condition in production
     */
    if (!env.no_networks) {
      return self.ackError
        ( self.msg.id
        , "Invalid, empty or missing value for 'networks'"
        );
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

// Add network provisioning information to the environment
function _addNetworkToEnv(prefix, network, env) {
  console.log(prefix + " network: " + sys.inspect(network));
  env[prefix + '_ip']        = network.ip;
  env[prefix + '_interface'] = network.interface;
  env[prefix + '_netmask']   = network.netmask;
  env[prefix + '_vlan_id']   = network.vlan_id;
  env[prefix + '_nic']       = network.nic;
  env[prefix + '_mac']       = network.mac;
  if (network.blocked_ports && network.blocked_ports["outgoing"]) {
    env[prefix + '_blocked_outgoing_ports'] = network.blocked_ports["outgoing"];
  }
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
    = new ThrottledQueue
        ( { connection: self.connection
          , queueName: self.config.resource + '-provisions.' + self.uuid
          , maximum: 3
          , routingKeys:
              [ [ self.config.resource + '-' + 'provisions'
                , self.uuid
                ].join('.')
              ]
          , queueOptions: { autoDelete: true }
          , callback: function (error, msg) {
              self.handleProvision(msg)
              self.provisionQueue.next();
            }
          }
        );
}

/*
 * Pushes a provision request onto the secondary provisoin queue, so we can do
 * them in parallel in the background.
 */

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

/**
 * Receive one provision message from the dedicated provision queue of
 * zones waiting to be booted and zoneinit'd. We'll keep track of the number of
 * provisions we have happening concurrently and prevent ourselves from
 * receiving too many requests.
 *
 * @param {Object} msg
 *   AMQP message JSON object.
 */

ProvisionerAgent.prototype.handleProvision = function (msg) {
  var self = this;
  self.shifting = false;

  self.log.provision.info("Attempting to provision");

  var provision = new ProvisionTask(self);

  provision.on('created', function () {
    self.provisionerEvent('zone_created', msg.data.zonename, msg.data.id);
  });

  provision.on('ready', function (logs) {
    self.provisionerEvent('zone_ready', msg.data.zonename, msg.data.id, logs);
    self.provisionQueue.complete();
  });

  provision.on('precheck_error', function (error) {
    self.provisionerEvent('error', msg.data.zonename, msg.data.id, error.toString());
    self.provisionQueue.complete();
  });

  /**
   * If we receive an error during the provision task and the
   * 'teardown_on_failure' flag is set and true on the provision message,
   * destroy the zone before continuing.
   */

  provision.on('error', function (error) {
    console.log("An error was detected during provisioning.");
    console.log("Teardown on failure kicking into effect.");
    if (msg.teardown_on_failure !== false) {
      teardown(msg, function (error) {
        fini();
      });
    }
    else {
      fini();
    }

    function fini () {
      self.provisionerEvent('error', msg.data.zonename, msg.data.id, error);
      self.provisionQueue.complete();
    }
  });

  provision.start(msg.data);
}

/**
 * Callsback with an agent handle we can use to send commands to other agents.
 */
ProvisionerAgent.prototype.getLocalAgentHandle = function (type, callback) {
  var self = this;

  // Return an existing handle if available.
  if (self.agentHandles && self.agentHandles[type]) {
    return callback(null, self.agentHandles[type]);
  }

  if (!self.agentClient) {
    var config = { timeout: 600000 };
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
