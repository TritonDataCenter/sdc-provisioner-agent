require.paths.push(__dirname + '/../lib');
require.paths.push(__dirname + '/..');

assert = require('assert');

sys = require('sys');
exec = require('child_process').exec;
fs = require('fs');
path = require('path');

puts = sys.puts;
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
      var successCount = 0;
      var authorized_keys = "ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEAs5xKh88/HuL+lr+i3DRUzcpkx5Ebbfq7NZVbjVZiICkhn6oCV60OGFmT5qsC2KTVyilakjU5tFlLSSNLQPbYs+hA2Q5tsrXx9JEUg/pfDQdfFjD2Rqhi3hMg7JUWxr9W3HaUtmnMCyrnJhgjA3RKfiZzY/Fkt8zEmRd8SZio0ypAI1IBTxpeaBQ217YqthKzhYlMh7pj9PIwRh7V0G1yDOCOoOR6SYCdOYYwiAosfFSMA2eMST4pjhnJTvrHMBOSn77lJ1hYPesjfjx/VpWIMYCzcP6mBLWaNGuJAIJMAk2EdNwO6tNoicQOH07ZJ4SbJcw6pv54EICxsaFnv0NZMQ== mastershake@mjollnir.local\n"

      var times = {};
      var zonesCreated = [];

      // The agent will emit events as it progresses through the zone creation
      // process. Make sure that the right number and types of events come in.
      var eventRE = /^provisioner\.event\.([^\.]+).([^\.]+).([^\.]+)/;
      var q = this.agent.connection.queue(testZoneName + '_events',
        function () {
          // provisioner.event.zone_created.sagan.orlandozone0
          var routing = 'provisioner.event.*.' + hostname + '.*';
          console.log("Routing was %s", routing);

          q.bind(routing);

          q.subscribeJSON(function (msg) {
            console.log("Event --> %j", msg);

            var zone_event = eventRE.exec(msg._routingKey);

            var authorizedKeysPath = path.join(
                                       "/zones/"
                                     , zone_event[3]
                                     , '/root/home/node/.ssh/authorized_keys'
                                     );


            if (zone_event[1] == "zone_created") {
              zonesCreated.push(zone_event[3]);
            }

            if (zone_event[1] == "zone_ready") {
              puts("Zone was ready in " + (Date.now() - times[zone_event[3]]) + "ms");

              fs.readFile(authorizedKeysPath, 'utf8', function (error, data) {
                assert.ok(!error, "Error reading authorized_keys file: "+error);
                assert.ok(data.indexOf(authorized_keys) !== -1
                  , "We should have found our key in the authorized keys file");
              });

              execFile('/usr/sbin/zoneadm'
              , ['list', '-p']
              , function (error, stdout, stderr) {
                  if (error) throw error;

                  var lines = stdout.split("\n");
                  assert.ok(
                    lines.some(function (line) {
                      var parts = line.split(':');
                      return parts[1] === testZoneName
                          && parts[2] === 'running';
                    })
                    , "our zone should be in the list");

                  puts("Everyone was ok!");
                  q.destroy();
                  finished();
              });
            }
          });

          var msg = { data: { zonename: testZoneName
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
                            } };
          times[msg.data.zonename] = Date.now();
          self.agent.sendCommand('provision', msg,
            function (reply) {
              if (reply.error) {
                console.log("ERROR: " + inspect(reply));
                finished();
              }

              // wait for provisioner events
            });
        });
    }
  }
, { 'Test adding to .authorized_keys after provisioning':
    function (assert, finished) {
      var self = this;
      var msg = { data: { zonename: testZoneName } };

      msg.data.authorized_keys = "ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEAs5xKh88/HuL+lr+i3DRUzcpkx5Ebbfq7NZVbjVZiICkhn6oCV60OGFmT5qsC2KTVyilakjU5tFlLSSNLQPbYs+hA2Q5tsrXx9JEUg/pfDQdfFjD2Rqhi3hMg7JUWxr9W3HaUtmnMCyrnJhgjA3RKfiZzY/Fkt8zEmRd8SZio0ypAI1IBTxpeaBQ217YqthKzhYlMh7pj9PIwRh7V0G1yDOCOoOR6SYCdOYYwiAosfFSMA2eMST4pjhnJTvrHMBOSn77lJ1hYPesjfjx/VpWIMYCzcP6mBLWaNGuJAIJMAk2EdNwO6tNoicQOH07ZJ4SbJcw6pv54EICxsaFnv0NZMQ== carl@mjollnir.local\nssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEAs5xKh88/HuL+lr+i3DRUzcpkx5Ebbfq7NZVbjVZiICkhn6oCV60OGFmT5qsC2KTVyilakjU5tFlLSSNLQPbYs+hA2Q5tsrXx9JEUg/pfDQdfFjD2Rqhi3hMg7JUWxr9W3HaUtmnMCyrnJhgjA3RKfiZzY/Fkt8zEmRd8SZio0ypAI1IBTxpeaBQ217YqthKzhYlMh7pj9PIwRh7V0G1yDOCOoOR6SYCdOYYwiAosfFSMA2eMST4pjhnJTvrHMBOSn77lJ1hYPesjfjx/VpWIMYCzcP6mBLWaNGuJAIJMAk2EdNwO6tNoicQOH07ZJ4SbJcw6pv54EICxsaFnv0NZMQ== meatwad@mjollnir.local\nssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEAs5xKh88/HuL+lr+i3DRUzcpkx5Ebbfq7NZVbjVZiICkhn6oCV60OGFmT5qsC2KTVyilakjU5tFlLSSNLQPbYs+hA2Q5tsrXx9JEUg/pfDQdfFjD2Rqhi3hMg7JUWxr9W3HaUtmnMCyrnJhgjA3RKfiZzY/Fkt8zEmRd8SZio0ypAI1IBTxpeaBQ217YqthKzhYlMh7pj9PIwRh7V0G1yDOCOoOR6SYCdOYYwiAosfFSMA2eMST4pjhnJTvrHMBOSn77lJ1hYPesjfjx/VpWIMYCzcP6mBLWaNGuJAIJMAk2EdNwO6tNoicQOH07ZJ4SbJcw6pv54EICxsaFnv0NZMQ== frylock@mjollnir.local\n"

      self.agent.sendCommand('add_authorized_keys', msg,
        function (reply) {
          assert.ok(!reply.error
            , "Shouldn't be an error but it was " + reply.error);
          puts("added an authorized key");

          var authorizedKeysPath
            = path.join(
                "/zones/"
              , testZoneName
              , 'root/home/node/.ssh/authorized_keys');


          fs.readFile(authorizedKeysPath, 'utf8', function (error, data) {
            assert.ok(!error, "Error reading authorized_keys file: "+error);
            assert.ok(data.indexOf("frylock@mjollnir.local") !== -1
              , "We should have found our key in the authorized keys file");
            assert.ok(data.indexOf("meatwad@mjollnir.local") !== -1
              , "We should have found our key in the authorized keys file");
            finished();
          });
        });
    }
}
, { 'Test tearing down one zone':
    function (assert, finished) {
      var self = this;
      var successCount = 0;

      var q = this.agent.connection.queue(testZoneName + 'x_events',
        function () {
          var routing = 'provisioner.event.zone_destroyed.*.*';
          console.log("Teardown Routing was %s", routing);
          q.bind(routing);
          q.subscribeJSON(function (msg) {
            puts("EVENT -->");
            // Check that the zone is not in list

            execFile('/usr/sbin/zoneadm'
              , ['list', '-p']
              , function (error, stdout, stderr) {
                  if (error) throw error;
                  puts("Listed -->" + stdout);
                  var lines = stdout.split("\n");
                  assert.ok(
                    !lines.some(function (line) {
                      var parts = line.split(':');
                      return parts[1] == testZoneName;
                    })
                    , "Our zone should not be in the list, but it was.");
                  puts("Everyone was ok!");
                  q.destroy();
                  finished();
                });
          });

          var msg = { data: { } };
          msg.data.zonename = testZoneName;
          self.agent.sendCommand('teardown', msg,
            function (reply) {
              assert.equal(reply.error
                , undefined,
                  "Error should be unset, but was '"
                  + inspect(reply.error) + "'.");
            puts("Zone destruction initiated");
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
//   agent = new ProvisionerAgent();
//   agent.connect(function () {
//     puts("Ready to rock.");
    callback && callback();
//   });
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
//       agent.end();
       client.end();
  }
});

if (module == require.main) {
  suite.runTests();
}
