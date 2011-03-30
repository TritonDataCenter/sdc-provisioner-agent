var EventEmitter = require('events').EventEmitter
  , async = require('async')
  , path = require('path')
  , fs = require('fs')
  , common = require('./common')
  , http = require('http')
  , qs = require('querystring');

/**
 * ProvisionTask constructor
 * @constructor
 */

var ProvisionTask = function (agent) {
  this.agent = agent;
  this.logs = {};
}

sys.inherits(ProvisionTask, EventEmitter);

module.exports = ProvisionTask;

/**
 * Initiates the provisioning process.
 * 
 * Provisioning a zone consists of a few steps:
 *   - check if zone template dataset exists, fetch if not
 *   - define zone configuration (resource caps)
 *   - run the provision script (scripts/provision.sh)
 *     - create zone (creates zone dataset)
 *     - configure zone networks
 *     - set zone metadata
 *   - watch the new zone's zoneinit log for success
 *   - reply with error/success depending on outcome
 */

ProvisionTask.prototype.start = function (env) {
  var self = this;

  var ENV = common.keysToUpper(env);
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

  /**
   * Ensure the system is in a sane state for provisioning.
   */

  self.preCheck(env, function (error) {
    if (error) {
      return self.emit('precheck_error', error);
    }

    doProvision();
  });

  function doProvision() {
    async.waterfall
      ( [ function (callback) {
            self.fetchDatasetIfMissing(env, callback)
          }
        , function (callback) {
            self.runProvisionScript(env, ENV, callback);
          }
        , function (callback) {
            self.waitUntilReboot(env, callback);
          }
        , function (callback) {
            self.readZoneinitLog(env, function (error, log) {
              if (error) {
                return callback(error);
              }
              self.logs.zoneinitsvc = log.toString();
              callback();
            });
          }
        , function (callback) {
            self.removeZoneinitServiceLog(env, function () {
              callback();
            });
          }
        ]
      , function (error) {
          if (error) {
            return self.emit('error', { error: error.toString(), logs: self.logs });
          }
          self.emit('ready', { logs: self.logs });
        }
      );
  }
}

/**
 * Do some preliminary checks to make sure the zone will be able to be created
 * successfully.
 */

ProvisionTask.prototype.preCheck = function (env, callback) {
  var self = this;
  console.log("Performing pre-provision check.");
  var zoneDataset = path.join(self.agent.config.zonesZpool, env.zonename);
  var zoneSnapshot
    = path.join
        ( self.agent.config.zonesZpool
        , env.dataset_uuid
        ) + '@' + env.zonename;

  async.waterfall
    ( [ function (callback) {
          // fail if zone with zonename exists
          common.zoneList(env.zonename, function (error, zones) {
            if (zones[env.zonename]) {
              callback(new Error("Zone " + env.zonename + " exists."));
              return;
            }
            callback();
          });
        }
      , function (callback) {
          // If we don't get an error on this `list` it means the dataset
          // exists.
          zfs.list(zoneDataset, function (error) {
            if (!error) {
              callback(new Error("Dataset " + zoneDataset + " exists."));
              return;
            }
            callback();
          });
        }
      , function (callback) {
          // If we don't get an error on this `list` it means the snapshot for
          // the zone template exists.
          zfs.list(zoneSnapshot, function (error) {
            if (!error) {
              callback(new Error("Snapshot " + zoneSnapshot + " exists."));
              return;
            }
            callback();
          });
        }
      ]
    , function (error) {
        if (error) {
          callback(error);
          return;
        }
        callback();
      }
    );
}

ProvisionTask.prototype.fetchDatasetIfMissing = function (env, callback) {
  var self = this;

  var dataset = env.dataset_uuid;
  var dataset_url_path = env.dataset_url_path;
  var fullDataset = self.agent.config.zonesZpool + '/' + dataset;
  console.log("Checking whether " + fullDataset + " exists on the system.");

  zfs.list
    ( fullDataset
    , onList
    );

  function onList (error, fields, list) {
    /***
     * If the dataset does exist continue with provisioning.
     */
    if (!error && list.length) {
      console.log("Dataset " + fullDataset + " exists.");
      return callback();
    }
    
    /***
     * Dataset didn't exist we'll have to fetch it from the given url to the
     * given dataset name.
     */

    var url
      = [ 'http://'
        , self.agent.sdcConfig['assets_admin_ip']
        , '/datasets/'
        , env.dataset_url_path
        ].join('');

    self.fetchDatasetFromURL(dataset, url, function (error) {
      if (error)
        return callback(error);
      callback();
    });
  }
}

ProvisionTask.prototype.fetchDatasetFromURL = function (dataset, url, callback) {
  var self = this;
  self.agent.getLocalAgentHandle('dataset', function (error, dsmanager) {
    dsmanager.sendCommand
      ( 'receive_url'
      , { url:        url
        , name:       [self.agent.config.zonesZpool, dataset].join('/')
        }
      , function (reply) {
          if (reply.error) {
            return callback(new Error(reply.error));
          }
          callback();
        }
      );
  });
}

/**
 * Execute the provision shell script.
 */
ProvisionTask.prototype.runProvisionScript = function (env, ENV, callback) {
  var self = this;
  var scriptPath = path.join(__dirname, '..', 'scripts', 'provision.sh');

  // If we get a test flag, deliberately make the request time out by not
  // responding.
  if (env.__test_zoneinit_timeout_error) {
    console.log("Deliberately timing out");
    self.emit('created');
    return callback(null, {});
  }

  console.log("Running provision.sh");
  execFile
    ( scriptPath
    , []
    , { encoding: 'utf8', env: ENV }
    , function (error, stdout, stderr) {
        self.logs.provision = { stdout: stdout, stderr: stderr };
        self.agent.log.provision.info('Provision Script Output:');
        self.agent.log.provision.info("STDOUT:\n" + stdout);
        self.agent.log.provision.info("STDERR:\n" + stderr);

        if (error) {
          callback(new Error("Error running provision.sh"));
          return;
        }

        self.emit('created');

        return callback();
      }
    );
}

/**
 * Read the zone's /var/log/zoneinit.log
 */
ProvisionTask.prototype.readZoneinitLog = function (env, callback) {
  var self = this;

  var logPath = path.join(this.agent.zonePath(env),
      'root/var/svc/log/system-zoneinit:default.log');

  fs.readFile(logPath, function (error, data) {
    if (error) {
      callback(new Error('Error reading ' + logPath + ': ' + error.toString()));
      return;
    }
    callback(null, data.toString());
  });
}

/**
 * Wait until a zone finishes rebooting.
 */
ProvisionTask.prototype.waitUntilReboot = function (env, callback) {
  var self = this;

  var timeoutAfterSeconds
    = (    env.zoneinit_timeout
        || self.agent.config.zoneinit_timeout
        || 300
      );

  console.log("Setting timeout on provision to fire after " + timeoutAfterSeconds + " seconds.");
  var timeout = setTimeout(onTimeout, timeoutAfterSeconds * 1000);

  whenZoneinitGone(function () {
    whenDoneRebooting(function (error) {
      clearTimeout(timeout);
      setTimeout(function () {
        callback();
      }, 10000);
    });
  });

  var checkRebootFile;
  var checkZoneinitGone;

  function whenZoneinitGone (callback) {
    checkZoneinitGone = setInterval(function () {
      execFile
        ( 'svcs'
        , [ '-H', '-o', 'STATE', '-z', env.zonename, 'zoneinit' ]
        , function (error, stdout, stderr) {
            if (!error) { 
              console.log
                ( "Service zoneinit for "
                  + env.zonename
                  + " was "
                  + stdout.trim()
                );
              return;
            }
            
            clearInterval(checkZoneinitGone);
            callback();
          }
        );
    }, 4000);
  }

  function whenDoneRebooting (callback) {
    checkRebootFile = setInterval(function () {
      var rebootFile
        = path.join
            ( self.agent.zonePath(env)
            , 'root/tmp/.FIRST_REBOOT_NOT_YET_COMPLETE'
            );

      path.exists
        ( rebootFile
        , function (exists) {
            if (exists) {
              console.log("File " + rebootFile + " still exists");
              return;
            }

            clearInterval(checkRebootFile);
            callback();
          }
        );
    }, 4000);
  }

  function onTimeout () {
    clearInterval(checkZoneinitGone);
    clearInterval(checkRebootFile);
    callback
      ( new Error
        ( "Timed out after waiting "
          + timeoutAfterSeconds + " seconds for "
          + "zone to reboot."
        )
      );
  }
};

/**
 * Deletes a zone's /var/svc/log/system-zoneinit:default.log file.
 */
ProvisionTask.prototype.removeZoneinitServiceLog = function (env, callback) {
  var logPath
    = path.join
        ( this.agent.zonePath(env)
        , 'root/var/svc/log/system-zoneinit:default.log'
        );
  fs.unlink(logPath, function (error) {
    callback();
  });
}
