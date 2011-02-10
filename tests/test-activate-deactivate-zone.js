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
        puts(inspect(arguments));
        if (error) {
          assert.ok(!error, "Expected no errors but found: " + error.toString());
        }
        finished();
      });
    }
  }
, { 'Test deactivating one zone':
    function (assert, finished) {
      var self = this;
      var successCount = 0;
      var msg = { data: { zonename: common.testZoneName } };

      self.agent.sendCommand('deactivate', msg,
        function (reply) {
          assert.ok(!reply.error, "Error should be unset, but was '" + inspect(reply.error) + "'.");
          execFile
            ( '/usr/sbin/zoneadm'
            , ['list', '-pi']
            , function (error, stdout, stderr) {
                if (error) throw error;
                console.log("Listed -->" + stdout);
                var lines = stdout.split("\n");
                assert.ok(
                  !lines.some(function (line) {
                    var parts = line.split(':');
                    return (
                         parts[1] == common.testZoneName
                      && parts[2] == 'running'
                      && parts[4] == '2e4a24af-97a2-4cb1-a2a4-1edb209fb311'
                    );
                  })
                  , "Our zone should not be in the list, but it was.");
                  console.log("Everyone was ok!");

                var dataset = 'zones/'+common.testZoneName;
                zfsProperties
                  ( [ 'smartdc.zone:deleted_at' ]
                  , dataset
                  , function (error, properties) {
                      console.dir(properties);
                      assert.ok
                        ( properties[dataset]['smartdc.zone:deleted_at']
                        , 'deleted_at property should be set'
                        );
                      assert.ok
                        ( /^\d{4}-\d{2}-\d{2}T.*Z$/
                          .exec(properties[dataset]['smartdc.zone:deleted_at'])
                        , 'deleted_at property should match regex'
                        );
                      finished();
                    }
                  );
              }
            );
        });
    }
  }
, { 'Test activating one zone':
    function (assert, finished) {
      var self = this;
      var successCount = 0;
      var msg = { data: { zonename: common.testZoneName } };

      self.agent.sendCommand('activate', msg,
        function (reply) {
          assert.ok(!reply.error, "Error should be unset, but was '" + inspect(reply.error) + "'.");
          setTimeout(function () {
            execFile('/usr/sbin/zoneadm'
            , ['list', '-pi']
            , function (error, stdout, stderr) {
              if (error) throw error;
              console.log("Listed -->" + stdout);
              var lines = stdout.split("\n");
              assert.ok
                ( lines.some(function (line) {
                    var parts = line.split(':');
                    return (
                         parts[1] == common.testZoneName
                      && parts[2] == 'running'
                      && parts[4] == '2e4a24af-97a2-4cb1-a2a4-1edb209fb311'
                    )
                  })
                , "Our zone should be in the list, but it was not."
                );
              console.log("Everyone was ok!");
              finished();
            });
          }, 5000);
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
