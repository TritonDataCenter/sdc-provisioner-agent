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
          self.followZoneinitServiceLog(env, callback);
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
 * Watch (by repeatedly stat'ing the file) the booting zone's
 * /var/svc/log/system-zoneinit:default.log file and run the callback when
 * we see the zoneinit service has exited.
 */
ProvisionTask.prototype.followZoneinitServiceLog = function (env, callback) {
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
        || 60
      );

  console.log("Timing provision out after " + timeoutAfterSeconds + " seconds.");
  var timeout = setTimeout(onTimeout, timeoutAfterSeconds * 1000);

  self.agent.log.provision.info('Watching ' + logPath);

  fs.watchFile(logPath, { interval: 1000 }, function (curr, prev) {
    if (curr.mtime == prev.mtime)  {
      self.agent.log.provision.error("Log file mtime hasn't changed\n");
      return;
    }
    self.agent.log.provision.info("Log file for zone '" + env.zonename + "' has changed. Checking...");

    // `log` will be set if we succeeded.
    checkLogfile(function (error, found, log) {
      // fire event here
      if (found) {
        callback(null, log);
      }
    });
  });

  /**
   * If we time out watching the log file, check one more time and fail if we
   * are still unsatisfied.
   */
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
  /**
   * Checks if the svc log file for zoneinit has indicated that the start
   * method has completed.
   */
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
