require.paths.unshift('./lib');
require.paths.unshift('.');

ProvisionerAgent = require('provisioner').ProvisionerAgent;

function main() {
  var agent = new ProvisionerAgent();
  agent.connect(function () {
    puts("Ready to rock.");
  });
}

main();
