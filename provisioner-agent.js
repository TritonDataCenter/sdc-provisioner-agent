path = require('path');
require.paths.unshift(path.join(__dirname, 'lib'));
require.paths.unshift(path.join(__dirname));

ini = require('ini');

ProvisionerAgent = require('provisioner').ProvisionerAgent;

function readConfig(cfgPath, callback) {
  puts("Config path:", cfgPath);

  fs.readFile(cfgPath, function (err, s) {
    var parsed = ini.parse(s.toString());
    var config = parsed['-'];
    delete parsed['-'];
    for (prop in parsed) {
      config[prop] = parsed[prop];
    }

    // deal with some values specially
    if (config.amqp.port) config.amqp.port = Number(config.amqp.port);


    puts("The Config:", inspect(config));
    callback(config);
  });
}

function main() {
  readConfig(path.join(__dirname, 'etc/provisioner.ini'), function (config) {
    var agent = new ProvisionerAgent(config);
    agent.connect(function () {
      puts("Ready to rock.");
    });
  });
}

main();
