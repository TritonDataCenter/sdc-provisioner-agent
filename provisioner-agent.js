#!/usr/bin/env node

// Joyent Provisioner: The Zone Provisioning Agent

var path = require('path')
  , fs = require('fs')
  , ini = require('./lib/ini')
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

  readConfig(configFilename, function (config) {
    var agent = new ProvisionerAgent(config);
    var signal = 'SIGWINCH';

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

    agent.configureAMQP(function () {
      agent.connect(function () {
        agent.setupProvisionQueue();
        console.log("Ready to rock.");
      });
    });
  });
}

main();
