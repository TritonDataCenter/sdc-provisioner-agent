require.paths.unshift('./lib');
require.paths.unshift('.');

ProvisionerAgent = require('provisioner').ProvisionerAgent;

function main() {
  var config = {
    hostname: 'sagan'
  };
  var agent = new ProvisionerAgent(config);
  agent.connect(function () {
    puts("Ready to rock.");
  });
}

main();
