exec = require('child_process').exec;
fs = require("fs");
sqlite = require("./node-sqlite/sqlite");
sys  = require('sys');
path  = require('path');
zonezfs = require('./lib/zonezfs');

AMQPAgent = require('./amqp_agent').AMQPAgent;

function CollectorAgent(config) {
  var self = this;

  config = config || {};
  config.amqp = config.amqp || {};
  config.resource = "provisioner";
  config.database_path = config.database_path
                         || path.join(__dirname, "collector.db");
  self.debug = config.debug;

  AMQPAgent.call(this, config);

  this.registerCommand("provision");
}

sys.inherits(CollectorAgent, AMQPAgent);

CollectorAgent.prototype.onCommand = function (command, msg) {
  var self = this;
  if (command !== "query")
    return;

  self.ackSuccess(msg.id);
}

function main() {
  var agent = new ProvisionerAgent();
  agent.connect(function () {
    puts("Ready to rock.");
  });
}

main();
