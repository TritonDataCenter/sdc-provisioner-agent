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

var suite = exports.suite = new TestSuite("Test zone properties");
var hostname;

var testZoneName = 'orlandozone';

var tests = [
 { 'Provision one zone':
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

                      , 'owner_uuid': 'old-uuid'
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
        zfsProperties
          ( [ 'smartdc:owner_uuid'
            , 'smartdc:charge_after'
            , 'smartdc:zone_type'
            , 'smartdc:za_version'
            ]
          , 'zones/orlandozone'
          , function (error, properties) {
              if (error) throw error;
              console.log(properties);

              assert.equal( properties['zones/orlandozone']['smartdc:owner_uuid']
                          , 'old-uuid');
              assert.equal( properties['zones/orlandozone']['smartdc:zone_type']
                          , 'node');
              assert.equal( properties['zones/orlandozone']['smartdc:za_version']
                          , '1.0');
              finished();
            });
        finished();
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
          zfsProperties
            ( [ 'smartdc:owner_uuid'
              , 'smartdc:charge_after'
              , 'smartdc:zone_type'
              , 'smartdc:za_version'
              ]
            , 'zones/orlandozone'
            , function (error, properties) {
                if (error) throw error;

                assert.equal( properties['zones/orlandozone']['smartdc:owner_uuid']
                            , 'the-new-uuid');
                assert.equal( properties['zones/orlandozone']['smartdc:zone_type']
                            , 'mysql');
                assert.equal( properties['zones/orlandozone']['smartdc:za_version']
                            , '1.0');
                assert.equal( properties['zones/orlandozone']['smartdc:charge_after']
                            , (new Date(100)).toISOString());
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
