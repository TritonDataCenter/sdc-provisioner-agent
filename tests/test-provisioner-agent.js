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

var testZoneName = 'orlandozone';

var tests = [
  { 'Test provisioning a zone':
    function (assert, finished) {
      var msg = { data: { 'zonename': testZoneName
                        , 'new_ip': '8.19.35.119'
                        , 'public_ip': '8.19.35.119'
                        , 'private_ip': '10.19.35.119'
                        , 'hostname': testZoneName
                        , 'zone_template': 'nodejs'
                        , 'public_interface_name':   testZoneName+'0'
                        , 'private_interface_name':  testZoneName+'2'
                        , 'physical_interface_name': testZoneName+'2'
                        , 'root_pw': 'therootpw'
                        , 'admin_pw': 'theadminpw'
                        , 'vs_pw': 'xxxtheadminpw'
                        , 'default_gateway': '8.19.35.1'
                        , 'public_netmask': '255.255.192.0'
                        , 'private_netmask': '255.255.192.0'
                        , 'cpu_shares': 15
                        , 'lightweight_processes': 4000
                        , 'cpu_cap': 350
                        , 'swap_in_bytes': 2147483648
                        , 'ram_in_bytes': 1073741824
                        , 'disk_in_gigabytes': 2
                        , 'tmpfs': 1024*1024*1024
                        , 'template_version': '3.0.0'
                        } };

      this.agent.sendCommand('provision', msg,
        function (reply) {
          assert.equal(reply.error, undefined,
            "Error should be unset, but was '" + inspect(reply.error) + "'");

          // Check that the zone is booted up
          execFile('/usr/sbin/zoneadm', ['list', '-p'],
            function (error, stdout, stderr) {
              if (error) throw error;

              var lines = stdout.split("\n");
              assert.ok(
                lines.some(function (line) { 
                  var parts = line.split(':');
                  return parts[1] == testZoneName
                         && parts[2] == 'running';
                })
                , "our zone should be in the list");
              finished();
            });
        });
    }
  }
, { 'Test tearing down a zone':
    function (assert, finished) {
      var msg = { data: { zonename: testZoneName } };
      this.agent.sendCommand('teardown', msg,
        function (reply) {
          assert.equal(reply.error, undefined,
            "Error should be unset, but was '" + inspect(reply.error) + "'");
          // Check that the zone is booted up
          execFile('/usr/sbin/zoneadm', ['list', '-p'],
            function (error, stdout, stderr) {
              if (error) throw error;

              var lines = stdout.split("\n");
              assert.ok(
                !lines.some(function (line) { 
                  var parts = line.split(':');
                  return parts[1] == testZoneName;
                })
                , "our zone should be in the list");
              finished();
            });
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
  agent = new ProvisionerAgent();
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
        config = { timeout: 20000, reconnect: false };
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
