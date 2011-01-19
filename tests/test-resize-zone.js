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
