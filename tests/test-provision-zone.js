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

var testZoneName = 'orlandozone';

var tests = [
 { 'Test provisioning one zone':
    function (assert, finished) {
      var self = this;
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
                      , 'authorized_keys': fakekeys.keys.mastershake
                      , 'inherited_directories': '/opt'
                      , 'admin_user': 'node'
                      }
      provisionZone(self.agent, data, function (error) {
        if (error) {
          console.log(error.toString());
          assert.ok(!error, "Error encountered: " + error.toString());
        }
        finished();
      });
    }
  }
, { 'Test adding to .authorized_keys after provisioning':
    function (assert, finished) {
      var self = this;
      var msg = { data: { user: 'node', zonename: testZoneName } };

      msg.data.authorized_keys = [ fakekeys.keys.mastershake
                                 , fakekeys.keys.frylock
                                 , fakekeys.keys.meatwad
                                 ].join("\n");

      self.agent.sendCommand('add_authorized_keys', msg,
        function (reply) {
          assert.ok(!reply.error
            , "Shouldn't be an error but it was " + reply.error);
          console.log("added an authorized key");

          var authorizedKeysPath
            = path.join(
                "/zones/"
              , testZoneName
              , 'root/home/node/.ssh/authorized_keys');


          fs.readFile(authorizedKeysPath, 'utf8', function (error, data) {
            assert.ok(!error, "Error reading authorized_keys file: "+error);
            assert.ok(data.indexOf("frylock@mjollnir.local") !== -1
              , "We should have found frylock key in the authorized keys file");
            assert.ok(data.indexOf("meatwad@mjollnir.local") !== -1
              , "We should have found meatwad key in the authorized keys file");
            finished();
          });
        });
    }
  }
, { 'Test adding to a non-existent user after provisioning':
    function (assert, finished) {
      var self = this;
      var msg = { data: { user: 'mistershake', zonename: testZoneName } };

      msg.data.authorized_keys
        = [ fakekeys.keys.pickles
          , fakekeys.keys.nathan
          , fakekeys.keys.murderface
          ];
      self.agent.sendCommand('add_authorized_keys', msg,
        function (reply) {
          assert.ok(reply.error
            , "There should have been an error");

          var authorizedKeysPath
            = path.join(
                "/zones/"
              , testZoneName
              , 'root/home/mistershake/.ssh/authorized_keys');

          path.exists(authorizedKeysPath, function (exists) {
            assert.ok(!exists, "authorized_keys file should not exist");
            finished();
          });
        });
    }
}
, { 'Test adding an array to .authorized_keys after provisioning':
    function (assert, finished) {
      var self = this;
      var msg = { data: { user: 'node', zonename: testZoneName } };

      msg.data.authorized_keys
        = [ fakekeys.keys.pickles
          , fakekeys.keys.nathan
          , fakekeys.keys.murderface
          ];
      self.agent.sendCommand('add_authorized_keys', msg,
        function (reply) {
          assert.ok(!reply.error
            , "Shouldn't be an error but it was " + reply.error);
          console.log("added an authorized key");

          var authorizedKeysPath
            = path.join(
                "/zones/"
              , testZoneName
              , 'root/home/node/.ssh/authorized_keys');


          fs.readFile(authorizedKeysPath, 'utf8', function (error, data) {
            assert.ok(!error, "Error reading authorized_keys file: "+error);
            assert.ok(data.indexOf(fakekeys.keys.pickles) !== -1
              , "We should have found our key in the authorized keys file");
            assert.ok(data.indexOf(fakekeys.keys.nathan) !== -1
              , "We should have found our key in the authorized keys file");
            assert.ok(data.indexOf(fakekeys.keys.murderface) !== -1
              , "We should have found our key in the authorized keys file");
            finished();
          });
        });
    }
}
, { 'Test adding an array of duplicates to .authorized_keys after provisioning':
    function (assert, finished) {
      var self = this;
      var msg = { data: { user: 'node', zonename: testZoneName } };

      msg.data.authorized_keys
        = [ fakekeys.keys.pickles
          , fakekeys.keys.nathan
          , fakekeys.keys.murderface
          ].join("\n");
      self.agent.sendCommand('add_authorized_keys', msg,
        function (reply) {
          assert.ok(!reply.error
            , "Shouldn't be an error but it was " + reply.error);
          console.log("added an authorized key");

          var authorizedKeysPath
            = path.join(
                "/zones/"
              , testZoneName
              , 'root/home/node/.ssh/authorized_keys');


          fs.readFile(authorizedKeysPath, 'utf8', function (error, data) {
            data = data.toString();
            console.log("THEKEYS");
            console.dir(data);
            assert.ok(!error, "Error reading authorized_keys file: "+error);

            var occ1 = countOccourances(fakekeys.keys.pickles, data);
            var occ2 = countOccourances(fakekeys.keys.nathan, data);
            var occ3 = countOccourances(fakekeys.keys.murderface, data);

            assert.equal
              ( occ1
              , 1
              , "Pickles Occurances should be 1 but was " + occ1);
            assert.equal
              ( occ2
              , 1
              , "Nathan Occurances should be 1 but was " + occ2);
            assert.equal
              ( occ3
              , 1
              , "Murderface Occurances hsould be 1 but was " + occ3);
            finished();
          });
        });
    }
}
, { 'Test overwriting .authorized_keys after provisioning':
    function (assert, finished) {
      var self = this;
      var msg = { data: { user: 'node', zonename: testZoneName, overwrite: true } };

      msg.data.authorized_keys = fakekeys.keys.ignignokt;

      self.agent.sendCommand('add_authorized_keys', msg,
        function (reply) {
          assert.ok(!reply.error
            , "Shouldn't be an error but it was " + reply.error)
          console.log("added an authorized key");

          var authorizedKeysPath
            = path.join(
                "/zones/"
              , testZoneName
              , 'root/home/node/.ssh/authorized_keys');

          fs.readFile(authorizedKeysPath, 'utf8', function (error, data) {
            if (error) throw error;
            assert.ok(!error, "Error reading authorized_keys file: "+error);
            assert.equal
              ( data.toString().trim()
              , msg.data.authorized_keys
              , "Authorized keys should match"
              );
            finished();
          });
        });
    }
  }
, { 'Test overwriting .authorized_keys with an array after provisioning':
    function (assert, finished) {
      var self = this;
      var msg = { data: { zonename: testZoneName
                        , overwrite: true
                        , user: 'node'
                        }
                };

      msg.data.authorized_keys 
        = [ fakekeys.keys.carl
          , fakekeys.keys.meatwad
          , fakekeys.keys.frylock
          ];

      self.agent.sendCommand('add_authorized_keys', msg,
        function (reply) {
          assert.ok(!reply.error
            , "Shouldn't be an error but it was " + reply.error);
          console.log("added an authorized key");

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
, { 'Test rejecting a suspicious authorized_keys file':
    function (assert, finished) {
      var self = this;
      var msg = { data: { user: 'node'
                        , zonename: testZoneName
                        , overwrite: true
                        }
                };

      msg.data.authorized_keys = fakekeys.keys.ignignokt;

      var authorizedKeysPath
        = path.join(
            "/zones/"
          , testZoneName
          , 'root/home/node/.ssh/authorized_keys');

      fs.unlink(authorizedKeysPath, function (error) {
        if (error) throw error;
        execFile
          ( '/usr/bin/ln'
          , [ '-s', ".", authorizedKeysPath ]
          , function (error, stdout, stderr) {
              if (error) throw new Error(stderr);

              self.agent.sendCommand('add_authorized_keys', msg,
                function (reply) {
                  assert.ok(reply.error
                    , "We should receive an error reply from agent")
                  finished();
                });
            }
          );
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
