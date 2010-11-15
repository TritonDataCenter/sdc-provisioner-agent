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

_getvers = function (callback) {
    var baseOS = "snv";
    var baseOS_vers = 121;

    execFile('/bin/uname'
  , ['-v']
  , []
  , function (error, stdout, stderr) {
      if (stdout) {
        var v = stdout.toString().trim().split("_");
        if (v.length == 2) {
          baseOS = v[0];
          baseOS_vers = v[1].replace(/\D+$/, '');
        }
      }
      callback(baseOS, baseOS_vers);
    });
}

function main() {
  readConfig(path.join(__dirname, 'etc/provisioner.ini'), function (config) {
    var agent = new ProvisionerAgent(config);

    _getvers(function (baseOS, baseOS_vers) {
      agent.baseOS = baseOS;
      agent.baseOS_vers = baseOS_vers;
      agent.zone_template_path = path.join(__dirname, 'support',
        (agent.baseOS_vers < 147) ?
          'zone_template.xml.ejs' :
          'zone_template2.xml.ejs');

      agent.connect(function () {
        agent.setupProvisionQueue();
        puts("Ready to rock.");
      });
    });
  });
}

main();
