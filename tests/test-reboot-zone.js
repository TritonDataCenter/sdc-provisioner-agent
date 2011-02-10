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

var tests = [
 { 'Test provisioning one zone':
    function (assert, finished) {
      var self = this;
      var data = common.provisionRequest();
      provisionZone(self.agent, data, function (error) {
        assert.equal(error, undefined);
        finished();
      });
    }
  }
  , { 'Test rebooting a zone':
  function (assert, finished) {
    var self = this;
    var successCount = 0;
    var msg = { data: { zonename: common.testZoneName } };

    var zoneBootTime1;
    var zoneBootTime2;

    // get the boot time on the zone before
    zoneadmList(function (error, zones) {
      assert.ok(!error);

      var zoneid = zones[common.testZoneName].zoneid;

      console.log("zone id is " + zoneid);
      zoneBootTime(common.testZoneName, function (error, bootTime) {
        if (error) throw error;
        zoneBootTime1 = bootTime;
        console.log("Boottime 1 was " + zoneBootTime1);

        function onReboot(reply) {
          assert.ok(!reply.error
          , "Error should be unset, but was '" + inspect(reply.error) + "'.");

          setTimeout(function () {
            // send the reboot command
            zoneBootTime(common.testZoneName, function (error, bootTime) {
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
      var data = { zonename: common.testZoneName };
      teardownZone(self.agent, data, function (error) {
        assert.ok(!error);

        zoneadmList(function (error, zones) {
          assert.ok(!zones[common.testZoneName], "zone should be gone");
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
