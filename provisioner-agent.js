#!/usr/bin/env node

// Joyent Provisioner: The Zone Provisioning Agent

path = require('path');
require.paths.unshift(path.join(__dirname, 'node_modules'));

ini = require('./lib/ini');
ProvisionerAgent = require('./lib/provisioner').ProvisionerAgent;

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

_getvers = function (callback) {
  var baseOS = "snv";
  var baseOS_vers = 121;

  execFile
    ( '/bin/uname'
    , ['-v']
    , []
    , function (error, stdout, stderr) {
        if (stdout) {
          var v = stdout.toString().trim().split("_");
          if (v.length == 2) {
            baseOS = v[0];
            baseOS_vers = v[1].replace(/\D+$/, '');
            baseOS_vers = baseOS_vers.replace(/T.*$/, '');
          }
        }
        callback(baseOS, baseOS_vers);
      });
}

function main() {
  var configFilename = path.join(__dirname, 'etc/provisioner.ini');

  if (process.env.PROVISIONER_CONFIG) {
    configFilename = process.env.PROVISIONER_CONFIG;
  }

  readConfig(configFilename, function (config) {
    var agent = new ProvisionerAgent(config);
    var signal = 'SIGWINCH';

    process.on(signal, function () {
      console.log("Received "+signal+". Attempting to stop processing requests and shut down.");
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

    _getvers(function (baseOS, baseOS_vers) {
      agent.baseOS = baseOS;
      agent.baseOS_vers = baseOS_vers;
      agent.zone_template_path = path.join(__dirname, 'support',
        (agent.baseOS_vers < 147) ?
          'zone_template.xml.ejs' :
          'zone_template2.xml.ejs');

      agent.configureAMQP(function () {
        agent.connect(function () {
          agent.setupProvisionQueue();
          console.log("Ready to rock.");
        });
      });
    });
  });
}

main();
