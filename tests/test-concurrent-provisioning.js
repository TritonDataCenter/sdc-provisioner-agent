require.paths.push(__dirname + '/../lib');
require.paths.push(__dirname + '/..');
require.paths.push(__dirname + '/../tests/lib');

assert = require('assert');

sys    = require('sys');
exec   = require('child_process').exec;
fs     = require('fs');
path   = require('path');
common = require('common');

setupSuiteAgentHandle = common.setupSuiteAgentHandle;

ProvisionerAgent  = require('provisioner').ProvisionerAgent;
ProvisionerClient = require('amqp_agent/client').Client;

TestSuite = require('async-testing/async_testing').TestSuite;

var suite = exports.suite = new TestSuite("Provisioner Agent Tests");

var testZoneName = 'orlandozone';

var zoneCount = 3;

var tests = [
  { 'Test provisioning a zone':
    function (assert, finished) {
      var self = this;

      var i = zoneCount;
      var provCount = 0;

      while (i--) {
        (function (i) {
          var data = { zonename: testZoneName + i
//                          , 'new_ip': '8.19.35.119'
//                          , 'public_ip': '8.19.35.119'
//                          , 'private_ip': '10.19.35.119'
//                          , 'default_gateway': '8.19.35.1'
//                          , 'public_netmask': '255.255.192.0'
//                          , 'private_netmask': '255.255.192.0'
                      , 'hostname': testZoneName + i
                      , 'zone_template': 'nodejs'
                      , 'root_pw': 'therootpw'
                      , 'admin_pw': 'theadminpw'
                      , 'vs_pw': 'xxxtheadminpw'
                      , 'cpu_shares': 15
                      , 'lightweight_processes': 4000
                      , 'cpu_cap': 350
                      , 'swap_in_bytes': 2147483648
                      , 'ram_in_bytes': 1073741824
                      , 'disk_in_gigabytes': 2
                      , 'tmpfs': '200m'
                      , 'template_version': '4.2.0'
                      , 'authorized_keys': 'shazbot'
                      };
          common.provisionZone(self.agent, data, function (error) {
            if (error) {
              console.log("ERROR:");
              console.dir(error);
            }
            if (++provCount == zoneCount) {
              finished();
            }
          });
        })(i);
      }
    }
  }
, { 'Test tearing down one zone':
    function (assert, finished) {
      var self = this;
      var teardownCount = 0;
      var i = zoneCount;

      while (i--) {
        (function (i) {
          var data = { zonename: testZoneName + i };
          common.teardownZone(self.agent, data, function (error) {
            assert.ok(!error);

            common.zoneadmList(function (error, zones) {
              assert.ok(!zones[testZoneName], "zone should be gone");

              if (++teardownCount == zoneCount) {
                finished();
              }
            });
          });
        })(i);
      }
    }
  }
];

// order matters in our tests
for (i in tests) {
  suite.addTests(tests[i]);
}

setupSuiteAgentHandle(suite);

var currentTest = 0;
var testCount = tests.length;

suite.teardown(function () {
  var self = this;
  if (++currentTest == testCount) {
    self.client.end();
  }
});

if (module == require.main) {
  suite.runTests();
}
