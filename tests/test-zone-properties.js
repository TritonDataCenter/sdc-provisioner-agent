path = require('path');

require.paths.push(path.join(__dirname, '/lib'));
require.paths.push(path.join(__dirname, '/../lib'));
require.paths.push(path.join(__dirname, '/..'));

assert = require('assert');
common = require('common');

provisionZone         = common.provisionZone;
teardownZone          = common.teardownZone;
zfsProperties         = common.zfsProperties;
zoneadmList           = common.zoneadmList;
setupSuiteAgentHandle = common.setupSuiteAgentHandle;
zoneAttrs             = common.zoneAttrs;

sys = require('sys');
exec = require('child_process').exec;
fs = require('fs');

inspect = sys.inspect;

ProvisionerAgent = require('provisioner').ProvisionerAgent;
ProvisionerClient = require('amqp_agent/client').Client;

TestSuite = require('async-testing/async_testing').TestSuite;

var suite = exports.suite = new TestSuite("Test zone properties");
var hostname;

var testZoneName = common.testZoneName;
var testZoneDataset = common.testZoneDataset;

var tests = [
 { 'Provision one zone':
    function (assert, finished) {
      var self = this;
      var data = common.provisionRequest();
      provisionZone(self.agent, data, function (error) {
        puts(inspect(arguments));
        if (error) {
          assert.ok(!error, "Expected no errors but found: " + error.toString());
        }

        zoneAttrs(testZoneName, function (error, attrs) {
          if (error) throw error;
          assert.equal(attrs['owner-uuid'], 'this-is-my-uuid');
          assert.equal(attrs['zone-type'], 'node');
          assert.equal(attrs['property-version'], '1.0');
          finished();
        });
      });
    }
  }
, { 'Test changing the zone\'s properties':
    function (assert, finished) {
      var self = this;
      var successCount = 0;
      var msg = { data: { zonename: testZoneName
                        , owner_uuid: 'the-new-uuid'
                        , charge_after: (new Date(100)).toISOString()
                        , zone_type: 'mysql'
                        }
                };

      self.agent.sendCommand('zone_properties', msg,
        function (reply) {
          if (reply.error) {
            assert.ok(!error, "There was an error" + error.toString());
            finished();
            return;
          }

        console.dir(reply);
        zoneAttrs(testZoneName, function (error, attrs) {
          assert.equal(attrs['owner-uuid'], 'the-new-uuid');
          assert.equal(attrs['charge-after'], (new Date(100)).toISOString());
          assert.equal(attrs['zone-type'], 'mysql');
          assert.equal(attrs['property-version'], '1.0');
          finished();
        });
      });
    }
  }
, { 'Tear down zone':
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
