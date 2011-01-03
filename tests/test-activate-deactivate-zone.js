path = require('path');

require.paths.push(path.join(__dirname, '/lib'));
require.paths.push(path.join(__dirname, '/../lib'));
require.paths.push(path.join(__dirname, '/..'));

assert = require('assert');
common = require('common');

provisionZone = common.provisionZone;
teardownZone  = common.teardownZone;
zfsProperties = common.zfsProperties;
zoneadmList   = common.zoneadmList;

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
                      , 'owner_uuid': 'this-is-my-uuid'
                      , 'uuid': '2e4a24af-97a2-4cb1-a2a4-1edb209fb311'
                      , 'zone_type': 'node'
                      , 'charge_after': (new Date()).toISOString()
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
      var msg = { data: { zonename: testZoneName } };

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
                         parts[1] == testZoneName
                      && parts[2] == 'running'
                      && parts[4] == '2e4a24af-97a2-4cb1-a2a4-1edb209fb311'
                    );
                  })
                  , "Our zone should not be in the list, but it was.");
                  console.log("Everyone was ok!");

                zfsProperties
                  ( [ 'smartdc:deleted_at' ]
                  , 'zones/orlandozone'
                  , function (error, properties) {
                      assert.ok
                        ( properties['zones/orlandozone']['smartdc:deleted_at']
                        , 'deleted_at property should be set'
                        );
                      assert.ok
                        ( /^\d{4}-\d{2}-\d{2}T.*Z$/
                          .exec(properties['zones/orlandozone']['smartdc:deleted_at'])
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
      var msg = { data: { zonename: testZoneName } };

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
                         parts[1] == testZoneName
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

var client;
var agent;

function startAgent(callback) {
  callback && callback();
}

suite.setup(function(finished, test) {
  var self = this;
  if (client) {
    client.getAgentHandle(hostname, 'provisioner', function (agentHandle) {
      self.agent = agentHandle;
      finished();
    });
  }
  else {
    exec('hostname', function (err, stdout, stderr) {
      hostname = stdout.trim();
      var dot = hostname.indexOf('.');
      if (dot !== -1) hostname = hostname.slice(0, dot);

      startAgent(function () {
        config = { timeout: 500000, reconnect: false };
        client = new ProvisionerClient(config);
        client.connect(function () {
          client.getAgentHandle(hostname, 'provisioner', function (agentHandle) {
            self.agent = agentHandle;
            finished();
          });
        });
      });
    });
  }
})

var currentTest = 0;
var testCount = tests.length;

suite.teardown(function() {
  if (++currentTest == testCount) {
    client.end();
  }
});

if (module == require.main) {
  suite.runTests();
}
