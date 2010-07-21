require.paths.push(__dirname + '/..');
require.paths.push(__dirname + '/../lib');

sys = require('sys');
exec = require('child_process').exec;
zfs = require('zfs').zfs;
fs = require('fs');
path = require('path');

puts = sys.puts;
inspect = sys.inspect;

ProvisionerAgent = require('provisioner').ProvisionerAgent;
ProvisionerClient = require('amqp_agent/client').Client;

TestSuite = require('async-testing/async_testing').TestSuite;

var suite = exports.suite = new TestSuite("Provisioner Agent Tests");
var hostname;

var tests = [
  { 'Test sending an incomplete provision command':
    function (assert, finished) {
      var msg = {};
      msg.data = {
        'zonename': 'orlandozone'
       , 'new_ip': '10.0.1.241'
       , 'public_ip': '10.0.1.240'
       , 'private_ip': '10.0.1.241'
       , 'hostname': 'myhostname.joyent.us'
       , 'zone_template': 'nodejs'
       , 'public_interface_name': 'e1000g0'
       , 'private_interface_name': 'e1000g0'
       , 'physical_interface_name': 'e1000g0'
       , 'root_pw': 'therootpw'
       , 'admin_pw': 'theadminpw'
       , 'vs_pw': 'theadminpw'
       , 'private_gateway': '10.0.1.1'
       , 'private_netmask': '255.255.255.0'
       , 'cpu_shares': 4
       , 'lightweight_processes': 40000
       , 'cpu_cap': 4
       , 'swap_in_bytes': 2000*1024*1024
       , 'ram_in_bytes': 2000*1024*1024
       , 'disk_in_gigabytes': 2
       , 'tmpfs': 2000*1024*1024
       , 'template_version': '3.0.0'
       };

      this.agent.sendCommand('provision', msg,
        function (reply) {
          assert.equal(reply.error, undefined,
            "Error should be unset, was '" + inspect(reply.error) + "'");
          finished();
        });
    }
  }
];

// order matters in our tests
for (i in tests) {
  suite.addTests(tests[i]);
}

var client;
var agent;

function startAgent(callback) {
  var config = {
    hostname: 'sagan'
  };
  agent = new ProvisionerAgent(config);
  agent.connect(function () {
    puts("Ready to rock.");
    callback && callback();
  });
}

suite.setup(function(finished, test) {
  var self = this;
  if (client) {
    self.agent = client.getAgentHandle(hostname, 'provisioner');
    finished();
  }
  else {
    exec('hostname', function (err, stdout, stderr) {
      hostname = stdout.trim();
      var dot = hostname.indexOf('.');
      if (dot !== -1) hostname = hostname.slice(0, dot);

      startAgent(function () {
        config = { reconnect: false };
        client = new ProvisionerClient(config);
        client.connect(function () {
          self.agent = client.getAgentHandle(hostname, 'provisioner');
          finished();
        });
      });
    });
  }
})

var currentTest = 0;
var testCount = tests.length;

suite.teardown(function() {
  if (++currentTest == testCount) {
    process.nextTick(function () {
      agent.end();
      client.end();
    });
  }
});

if (module == require.main) {
  suite.runTests();
}
