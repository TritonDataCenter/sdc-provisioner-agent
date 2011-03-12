path = require('path');
require.paths.push(path.join(__dirname, '/lib'));
require.paths.push(path.join(__dirname, '/../lib'));
require.paths.push(path.join(__dirname, '/..'));


sys = require('sys');
exec = require('child_process').exec;
fs = require('fs');
fakekeys = require('fakekeys');
common = require('common');

provisionZone         = common.provisionZone;
zoneadmList           = common.zoneadmList;
teardownZone          = common.teardownZone;
setupSuiteAgentHandle = common.setupSuiteAgentHandle;

ProvisionerAgent = require('provisioner').ProvisionerAgent;

TestSuite = require('async-testing/async_testing').TestSuite;

var suite = exports.suite = new TestSuite("Provisioner Agent Tests");

testZoneName    = common.testZoneName;
testZoneDataset = common.testZoneDataset;
adminUser       = common.testAdminUser();

var tests = [
 { 'Test provisioning one zone':
    function (assert, finished) {
      var self = this;
      var data = common.provisionRequest();
      provisionZone(self.agent, data, function (error) {
        if (error) {
          console.log(error.toString());
          assert.ok(!error, "Error encountered: " + error.toString());
        }
        finished();
      });
    }
  }
, { "provision zone using name of zone that already exists":
    function (assert, finished) {
      var self = this;
      var data = common.provisionRequest();
      provisionZone(self.agent, data, function (error) {
        console.log(error.toString());
        finished();
      });
    }
  }
, { "provision zone using template that doesn't exist in assets":
    function (assert, finished) {
      var self = this;
      var data
        = common.provisionRequest
            ( { zonename: "slappy"
              , zone_template: 'idontexist-4.2.0'
              }
            );
      provisionZone(self.agent, data, function (error) {
        assert.ok(error, "Expected error yet found none");
        finished();
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

function countOccourances(needle, haystack) {
  var count = 0;
  var str = haystack;

  while (true) {
    var idx = str.indexOf(needle);
    if (idx === -1)
      return count;

    count++;
    str = str.slice(idx+1);
  }
}

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
    self.agent.connection.end();
  }
});

if (module == require.main) {
  suite.runTests();
}
