var EventEmitter = require('events').EventEmitter
  , async = require('async')
  , path = require('path')
  , fs = require('fs')
  , common = require('./common')
  , http = require('http');

/**
 * ProvisionTask constructor
 * @constructor
 */

var ProvisionTask = function (agent) {
  this.agent = agent;
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
            self.fetchDatasetIfMissing(env, env.zone_template, callback)
          }
        , function (callback) {
            self.runProvisionScript(env, ENV, callback);
          }
        , function (provisionLog, callback) {
            provisionLogs.provision_sh = provisionLog;
            self.waitUntilReboot(env, callback);
          }
        , function (zoneinitLog, callback) {
            provisionLogs.zoneinit_log = zoneinitLog;
            callback();
          }
        , function (callback) {
            self.removeZoneinitServiceLog(env, function () {
              callback();
            });
          }
        ]
      , function (error) {
          if (error) {
            return self.emit('error', error);
          }

          self.emit('ready', { logs: provisionLogs });
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
        , env.zone_template
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

/**
 * Checks if a dataset installed on the system and fetches it otherwise. Uses
 * the dataset manager to fetch the dataset.
 *
 * For example, if given zone_template: nodejs-0.4.0
 *
 * Check if zones/nodejs-0.4.0 exists.
 * If it does exist, good, use it.
 * If it doesn't exist, do a dsapi search for name=nodejs-0.4.0
 * If it doesn't exist, return error back.
 */

ProvisionTask.prototype.fetchDatasetIfMissing = function (env, dataset, callback) {
  var self = this;

  console.log("Checking whether " + dataset + " exists on the system.");
  zfs.list
    ( self.agent.config.zonesZpool + '/' + dataset
    , onList
    );

  function onList (error, fields, list) {
    /***
     * If the dataset does exist continue with provisioning.
     */
    if (!error && list.length) {
      console.log(dataset + " exists.");
      return callback();
    }
    
    /***
     * Dataset didn't exist, try to look up its dataset url from the
     * Dataset API service.
     */
    console.log("Dataset not found locally. Querying Dataset API.");
    var query = {
      name: dataset
    };
    self.queryDatasetAPI(query, function (error, response) {
      console.log("Dataset query response:");
      console.dir(response);
      if (error) {
        return callback(error);
      }

      if (!response || response.length == 0) {
        return callback
          ( new Error
              ( "Dataset " + dataset
                + " could not be found in the dataset API."
              )
           );
      }

//       var url = response[0].files[0].url;
      var url
        = [ 'http://'
          , self.agent.sdcConfig['assets_admin_ip']
          , '/'
          , response[0].files[0].path
          ].join('');

      self.fetchDatasetFromURL(dataset, url, function (error) {
        if (error)
          return callback(error);
        callback();
      });
    });
  }
}

ProvisionTask.prototype.fetchDatasetFromURL = function (dataset, url, callback) {
  var self = this;
  self.agent.getLocalAgentHandle('dataset', function (error, dsmanager) {
    dsmanager.sendCommand
      ( 'receive_url'
      , { filesystem: self.agent.config.zonesZpool
        , url:        url
        , if_missing: dataset
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
 * queryDatasetAPI
 */
ProvisionTask.prototype.queryDatasetAPI = function (query, callback) {
  var self = this;
  
  var datasetUrl = '';
  var options
    = { host: self.agent.sdcConfig['assets_admin_ip']
      , port: 3001 // XXX TODO unhardcode this
      , path: '/datasets?name=' + query.name
      };

  http.get(options, function (response) {
    var body = '';
    console.log("Dataset API response:");
    console.dir(response);
    response.on('data', function (data) {
      body += data.toString();
    })
    response.on('end', function () {
      var obj = JSON.parse(body);
      callback(null, obj);
    })
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
    , { env: common.extend(process.env, ENV) }
    , function (error, stdout, stderr) {
        if (error) {
          callback(new Error(stderr.toString()));
          return;
        }
        self.emit('created');

        self.agent.log.provision.info('Provision Script Output:');
        self.agent.log.provision.info("STDOUT:\n" + stdout);
        self.agent.log.provision.info("STDERR:\n" + stderr);

        var logs = { stdout: stdout, stderr: stderr };

        return callback(null, logs);
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

  var logPath
    = path.join
        ( self.agent.zonePath(env)
        , 'root/var/svc/log/system-zoneinit:default.log'
        );

  var timeoutAfterSeconds
    = (    env.zoneinit_timeout
        || self.agent.config.zoneinit_timeout
        || 300
      );

  console.log("Setting timeout on provision after " + timeoutAfterSeconds + " seconds.");
  var timeout = setTimeout(onTimeout, timeoutAfterSeconds * 1000);

  self.agent.log.provision.info('Watching ' + logPath);

  whenZoneinitGone(function () {
    whenDoneRebooting(function (error, log) {
      clearTimeout(timeout);
      setTimeout(function () {
        callback(null, log);
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
            self.readZoneinitLog(env, function (error, log) {
              if (error) {
                return callback(error);
              }
              callback(null, log.toString());
            });
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
