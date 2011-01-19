path = require('path');

require.paths.push(path.join(__dirname, '/lib'));
require.paths.push(path.join(__dirname, '/../lib'));
require.paths.push(path.join(__dirname, '/..'));

assert = require('assert');
common = require('common');

provisionZone         = common.provisionZone;
zoneadmList           = common.zoneadmList;
zoneBootTime          = common.zoneBootTime;
teardownZone          = common.teardownZone;
setupSuiteAgentHandle = common.setupSuiteAgentHandle;

sys = require('sys');
exec = require('child_process').exec;
fs = require('fs');

inspect = sys.inspect;

ProvisionerAgent = require('provisioner').ProvisionerAgent;
ProvisionerClient = require('amqp_agent/client').Client;

TestSuite = require('async-testing/async_testing').TestSuite;

var suite = exports.suite = new TestSuite("Provisioner Agent Tests");
var hostname;

var testZoneName = 'orlandozone';

var tests = [
 { 'Test provisioning one zone':
    function (assert, finished) {
      var self = this;
      var authorized_keys = "ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEAs5xKh88/HuL+lr+i3DRUzcpkx5Ebbfq7NZVbjVZiICkhn6oCV60OGFmT5qsC2KTVyilakjU5tFlLSSNLQPbYs+hA2Q5tsrXx9JEUg/pfDQdfFjD2Rqhi3hMg7JUWxr9W3HaUtmnMCyrnJhgjA3RKfiZzY/Fkt8zEmRd8SZio0ypAI1IBTxpeaBQ217YqthKzhYlMh7pj9PIwRh7V0G1yDOCOoOR6SYCdOYYwiAosfFSMA2eMST4pjhnJTvrHMBOSn77lJ1hYPesjfjx/VpWIMYCzcP6mBLWaNGuJAIJMAk2EdNwO6tNoicQOH07ZJ4SbJcw6pv54EICxsaFnv0NZMQ== mastershake@mjollnir.local\n";
      var data = { zonename: testZoneName
//                             , 'new_ip': '8.19.35.119'
//                             , 'public_ip': '8.19.35.119'
//                             , 'private_ip': '10.19.35.119'
//                             , 'default_gateway': '8.19.35.1'
//                             , 'public_netmask': '255.255.192.0'
//                             , 'private_netmask': '255.255.192.0'
//                             ,  'public_vlan_id': 420
                      , 'hostname': testZoneName
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
                      , 'authorized_keys': authorized_keys
                      }
      provisionZone(self.agent, data, function (error) {
        assert.ok(!error);
        finished();
      });
    }
  }
  , { 'Test rebooting a zone':
  function (assert, finished) {
    var self = this;
    var successCount = 0;
    var msg = { data: { zonename: testZoneName } };

    var zoneBootTime1;
    var zoneBootTime2;

    // get the boot time on the zone before
    zoneadmList(function (error, zones) {
      assert.ok(!error);

      var zoneid = zones[testZoneName].zoneid;

      console.log("zone id is " + zoneid);
      zoneBootTime(testZoneName, function (error, bootTime) {
        if (error) throw error;
        zoneBootTime1 = bootTime;
        console.log("Boottime 1 was " + zoneBootTime1);

        function onReboot(reply) {
          assert.ok(!reply.error
          , "Error should be unset, but was '" + inspect(reply.error) + "'.");

          setTimeout(function () {
            // send the reboot command
            zoneBootTime(testZoneName, function (error, bootTime) {
              zoneBootTime2 = bootTime;
              console.log("Boottime 2 was " + zoneBootTime2);

              assert.ok(zoneBootTime > zoneBootTime1);
              puts("All done!");
              finished();
            });
          }, 5000);
        };

        self.agent.sendCommand('reboot', msg, onReboot);
      });
    });
  }
}
, { 'Test tearing down one zone':
    function (assert, finished) {
      var self = this;
      var data = { zonename: testZoneName };
      teardownZone(self.agent, data, function (error) {
        assert.ok(!error);

        zoneadmList(function (error, zones) {
          assert.ok(!zones[testZoneName], "zone should be gone");
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
