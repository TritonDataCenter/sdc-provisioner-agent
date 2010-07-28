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

var zoneCount = 1;

var tests = [
 { 'Test provisioning a zone':
    function (assert, finished) {
      var self = this;
      var successCount = 0;

      // count the number of events we get
      var events = {
        zone_created: 0,
        zone_ready: 0,
      };

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
            // Check that the zone is booted up
            var zone_event = eventRE.exec(msg._routingKey);
            events[zone_event[1]]++;
            if (zone_event[1] == "zone_ready") {
              puts("Zone was ready!");
              execFile('/usr/sbin/zoneadm'
                , ['list', '-p']
                , function (error, stdout, stderr) {
                    if (error) throw error;

                    var lines = stdout.split("\n");
                    assert.ok(
                      lines.some(function (line) { 
                        var parts = line.split(':');
                        return parts[1] == zone_event[3]
                               && parts[2] == 'running';
                      })
                      , "our zone should be in the list");
                  
                    if (++successCount == zoneCount) {
                      assert.equal(events.zone_created, zoneCount);
                      assert.equal(events.zone_ready, zoneCount);
                      puts("Everyone was ok!");
                      q.destroy();
                      finished();
                    }
                  }); 
            }
          });

          var i = zoneCount;

          while (i--) {
            (function (i) {
              var msg = { data: { zonename: testZoneName + i
//                             , 'new_ip': '8.19.35.119'
//                             , 'public_ip': '8.19.35.119'
//                             , 'private_ip': '10.19.35.119'
//                             , 'default_gateway': '8.19.35.1'
//                             , 'public_netmask': '255.255.192.0'
//                             , 'private_netmask': '255.255.192.0'
                                , 'hostname': testZoneName + i
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
                                } };
              self.agent.sendCommand('provision', msg,
                function (reply) {
                  if (reply.error) {
                    puts("ERROR", inspect(reply));
                    puts("MSG", inspect(msg));
                  }
                });
            })(i);
          }
        });
    }
  }
, { 'Test tearing down a zone':
    function (assert, finished) {
      var self = this;
      var successCount = 0;

      var q = this.agent.connection.queue(testZoneName + 'x_events', 
        function () {
          var routing = 'provisioner.event.zone_destroyed.*.*';
          console.log("Routing was %s", routing);
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
                  if (++successCount == zoneCount) {
                    puts("Everyone was ok!");
                    q.destroy();
                    finished();
                  }
                });
          });

          var i = zoneCount;

          while (i--) {
            (function (i) {
              var msg = { data: { } };
              msg.data.zonename = testZoneName + i;
              self.agent.sendCommand('teardown', msg,
                function (reply) {
                  assert.equal(reply.error, undefined,
                    "Error should be unset, but was '" + inspect(reply.error) + "'.");
                  puts("Zone destruction initiated");
                });
            })(i);
          }
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
        config = { timeout: 5000, reconnect: false };
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
