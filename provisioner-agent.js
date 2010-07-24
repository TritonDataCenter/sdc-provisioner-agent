path = require('path');
require.paths.unshift(path.join(__dirname, 'lib'));
require.paths.unshift(path.join(__dirname));

ProvisionerAgent = require('provisioner').ProvisionerAgent;

function main() {
  var agent = new ProvisionerAgent();
  agent.connect(function () {
    puts("Ready to rock.");
  });
}

main();
