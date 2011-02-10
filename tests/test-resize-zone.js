path = require('path');

require.paths.push(path.join(__dirname, '/lib'));
require.paths.push(path.join(__dirname, '/../lib'));
require.paths.push(path.join(__dirname, '/..'));

assert = require('assert');
common = require('common');

provisionZone         = common.provisionZone;
zoneadmList           = common.zoneadmList;
zoneBootTime          = common.zoneBootTime;
prctl                 = common.prctl;
teardownZone          = common.teardownZone;
setupSuiteAgentHandle = common.setupSuiteAgentHandle;
testZoneName = common.testZoneName;

sys = require('sys');
exec = require('child_process').exec;
fs = require('fs');

inspect = sys.inspect;

ProvisionerAgent = require('provisioner').ProvisionerAgent;
ProvisionerClient = require('amqp_agent/client').Client;

TestSuite = require('async-testing/async_testing').TestSuite;

var suite = exports.suite = new TestSuite("Provisioner Agent Tests");
var hostname;


function prctlValue(zonename, resource, callback) {
  execFile
    ( '/usr/sbin/zonecfg'
    , ['-z', zonename, 'info', 'rctl', 'name='+resource]
    , function (error, stdout, stderr) {
        if (error) throw error;
        var lines = stdout.split("\n");
        var i = lines.length;

        while (i--) {
          var m = /^\s+value:.*?limit=(\d+)/.exec(lines[i]);
          if (m) {
            return callback(null, m[1]);
          }
        }
        return callback(new Error("Value not found"));
      }
    );
}

var tests = [
 { 'Test provisioning one zone':
    function (assert, finished) {
      var self = this;
      var data = common.provisionRequest();
      provisionZone(self.agent, data, function (error) {
        assert.ok(!error);
        finished();
      });
    }
  }
, { 'Test resizing a zone':
    function (assert, finished) {
      var self = this;
      var msg = { data: { zonename: testZoneName
                        , lightweight_processes: 5000 } };

      function onResize(reply) {
        var resource = 'zone.max-lwps';
        assert.ok(!reply.error);
        if (reply.error) finished();

        // check that the value has taken effect in the running system
        prctl
          ( testZoneName
          , resource
          , function (error, zone) {
              assert.equal
                ( zone[2]
                , 5000
                , "lightweight_processes value should've been set"
                );

              // check that the configuarion has been recorded in zonecfg
              prctlValue
                ( testZoneName
                , resource
                , function (error, value) {
                    assert.equal
                      ( value
                      , 5000
                      , "zonecfg should report the right value for lwps"
                      );
                    finished();
                  }
                );
            }
          );
      }

      self.agent.sendCommand('resize', msg, onResize);
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
