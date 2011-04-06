#!/usr/bin/env node

// Joyent Provisioner: The Zone Provisioning Agent

var path = require('path')
  , fs = require('fs')
  , ini = require('./lib/ini')
  , async = require('async')
  , ProvisionerAgent = require('./lib/provisioner').ProvisionerAgent;

/**
 * readConfig
 *
 * @param {String} cfgPath Document me!
 * @param {Function} callback Document me!
 */

function readConfig(cfgPath, callback) {
  console.log("Config path: " + cfgPath);

  fs.readFile(cfgPath, function (err, s) {
    var parsed = ini.parse(s.toString());
    var config = parsed['-'];
    delete parsed['-'];
    for (prop in parsed) {
      config[prop] = parsed[prop];
    }

    console.log("Configuration:\n" +  inspect(config));
    callback(config);
  });
}

/**
 * main
 */

function main() {
  var configFilename = path.join(__dirname, 'etc/provisioner.ini');

  if (process.env.PROVISIONER_CONFIG) {
    configFilename = process.env.PROVISIONER_CONFIG;
  }

  var agent;
  var signal = 'SIGWINCH';
  var config;

  async.waterfall
    ( [ function (callback) {
          readConfig(configFilename, function (c) {
            config = c;
            callback();
          });
        }
      , function (callback) {
          if (!config.max_concurrent_provisions) {
            console.log("Maximum concurrent provisions not specified");
            getProcessorCount(function (error, nprocs) {
              console.log("Defaulting to number of processors: " + nprocs);
              config.max_concurrent_provisions = nprocs;
              callback();
            });
          }
          else {
            console.log
              ( "Maximum concurrent provisions: "
                + config.max_concurrent_provisions);
            callback();
          }
        }
      , function (callback) {
          agent = new ProvisionerAgent(config);
          callback();
        }
      , function (callback) {
          process.on(signal, function () {
            console.log
              ( "Received "
                + signal
                + ". Attempting to stop processing requests and shut down."
              );
            agent.stopShifting();

            // Wait until agent indicates it is done.
            var interval = setInterval(function () {
              if (agent.isDone()) {
                clearInterval(interval);
                agent.end();
                console.log("All done...");
                return;
              }
              else {
                console.log("Agent not yet done");
              }
            }, 1000);
          });

          agent.zone_template_path
            = path.join(__dirname, 'support', 'zone_template.xml.ejs');
          callback();
        }
      , function (callback) {
          agent.configureAMQP(function () {
            callback();
          });
        }
      ]
    , function (error) {
        if (error) throw error;
        agent.connect(function () {
          agent.setupProvisionQueue();
          console.log("Ready to rock.");
        });
      }
    );
}

function getProcessorCount(callback) {
  execFile
    ( '/usr/sbin/psrinfo'
    , ['-p']
    , { encoding: 'utf8' }
    , function (error, stdout, stderr) {
        if (error) return callback(new Error(stderr.toString()));
        var num = Number(stdout.trim());
        callback(null, num);
      }
    );
}

main();
