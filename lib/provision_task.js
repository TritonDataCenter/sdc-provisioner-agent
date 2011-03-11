var EventEmitter = require('events').EventEmitter
  , async = require('async')
  , path = require('path')
  , fs = require('fs')
  , common = require('./common');

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
    if (['authorized_keys'].indexOf(keys[i]) !== -1) {
      continue;
    }
    zoneConfig += keys[i];
    zoneConfig += '="' + String(ENV[keys[i]]).replace("\\","\\\\")
                                             .replace("\"","\\\"") + "\"\n";
  }

  ENV.ZONECONFIG = zoneConfig;

  var provisionLogs = {};

  async.waterfall
    ( [ function (callback) {
          self.fetchDatasetIfMissing(env.zone_template, callback)
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
          self.removeZoneinitServiceLog(env, function (error) {
            callback();
          });
        }
      ]
    , function (error) {
        if (error) {
          self.emit('error', error);
          return;
        }

        self.emit('ready', { logs: provisionLogs });
      }
    );
}

/**
 * Checks if a dataset installed on the system and fetches it otherwise. Uses
 * the dataset manager to fetch the dataset.
 */

 ProvisionTask.prototype.fetchDatasetIfMissing = function (dataset, callback) {
  var self = this;
  var url = 'http://'+self.agent.sdcConfig['assets_admin_ip'] +'/datasets/' + dataset + '.zfs.bz2';
  console.log("Checking whether " + dataset + " exists on the system");

  zfs.list(self.agent.config.zonesZpool + '/' + dataset, function (error, fields, list) {
    if (!error && list.length) {
      console.log(dataset + " exists.");
      callback();
    }
    else {
      console.log(dataset + " does NOT yet exist.");
      // Dataset is missing, so we'll send a message to the dataset-manager
      // agent to zfs receive it from the assets zone.
      console.log("Fetching " + dataset + " from " + url);
      self.agent.getLocalAgentHandle('dataset', function (error, dsmanager) {
        dsmanager.sendCommand
          ( 'receive_url'
          , { filesystem: self.agent.config.zonesZpool, url: url, if_missing: dataset }
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
  self.agent.log.provision.info('Reading ' + logPath);

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

  // Create a file stream and then watch for exit
  var logPath = path.join(self.agent.zonePath(env),
      'root/var/svc/log/system-zoneinit:default.log');

  /**
   * Start checking the log file. If it hasn't been updated before the
   * timeout, we should check it one last time and then fail?
   */
  var timeoutAfterSeconds
    = (    env.zoneinit_timeout
        || self.agent.config.zoneinit_timeout
        || 300
      );

  console.log("Timing provision out after " + timeoutAfterSeconds + " seconds.");
  var timeout = setTimeout(onTimeout, timeoutAfterSeconds * 1000);

  self.agent.log.provision.info('Watching ' + logPath);

  whenZoneinitGone(function () {
    whenDoneRebooting(function (error, log) {
      whenZoneinitGone(function () {
        clearInterval(timeout);
        setTimeout(function () {
          callback(null, log);
        }, 5000);
      });
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
              console.log("Service zoneinit for " + env.zonename + " was " + stdout.trim());
              return;
            }
            
//             execFile
//               ( '/usr/sbin/zoneadm'
//               , [ 'list', '-pc' ]
//               , function (error, stdout, stderr) {
//                   if (error) { 
//                     console.log("Error zonadming");
//                     return;
//                   }
//                   console.log("Zones after boot");
//                   console.log(stdout);
                  clearInterval(checkZoneinitGone);
                  callback();
//                 }
//               );
          }
        );
    }, 4000);
  }

  function whenDoneRebooting (callback) {
    checkRebootFile = setInterval(function () {
      var rebootFile = path.join(self.agent.zonePath(env), 'root/tmp/.FIRST_REBOOT_NOT_YET_COMPLETE');
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
  var logPath = path.join(this.agent.zonePath(env),
      'root/var/svc/log/system-zoneinit:default.log');
  fs.unlink(logPath, function (error) {
    callback();
  });
}
