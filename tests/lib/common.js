execFile = require('child_process').execFile;
inspect = require('sys').inspect;

assert = require('assert');
// Use to test on 147 in the GZ:
// require.paths.unshift('/opt/smartdc/agents/modules/.npm/provisioner/active/package/node_modules');
ProvisionerClient = require('amqp_agent/client').Client;

fakekeys = require('fakekeys');
// The agent will emit events as it progresses through the zone creation
// process.
var eventRE = /^provisioner\.event\.([^\.]+).([^\.]+).([^\.]+)/;

exports.testZoneName = 'provisioner-test';
exports.testZoneDataset = 'zones/' + exports.testZoneName;

exports.testDataset = function () {
  if (process.env['TEST_DATASET']) {
    return process.env['TEST_DATASET'];
  }
  return 'bare';
}

exports.testAdminUser = function () {
  if (process.env['TEST_ADMIN_USER']) {
    return process.env['TEST_ADMIN_USER'];
  }
  return 'admin';
}

exports.provisionRequest = function (vars) {
  var testDataset   = exports.testDataset();
  var testAdminUser = exports.testAdminUser();
  console.log("ADMIN_USER WAS " + testAdminUser);
  vars = vars || {};
  var defaults = { 'zonename': exports.testZoneName
                 , 'admin_user': testAdminUser
//                  , 'new_ip': '8.19.35.119'
//                  , 'public_ip': '8.19.35.119'
//                  , 'private_ip': '10.19.35.119'
//                  , 'default_gateway': '8.19.35.1'
//                  , 'public_netmask': '255.255.192.0'
//                  , 'private_netmask': '255.255.192.0'
//                  , 'public_vlan_id': 420
                 , 'hostname': exports.testZoneName
                 , 'zone_template': testDataset
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
                 , 'authorized_keys': fakekeys.keys.mastershake
                 };

  var keys = Object.keys(defaults);
  for (var i=0; i<keys.length; i++) {
    if (vars[keys[i]] === undefined) {
      vars[keys[i]] = defaults[keys[i]];
    }
  }

  return vars;
}

exports.provisionZone = function (agent, data, callback) {
  var times = {};

  var admin_user = data.admin_user || 'node';
  var q;

  q = agent.connection.queue(data.zonename + '_provision_events'+Math.random(), queueCreated);
  function eventReceived(msg) {
    console.log("Event --> " + inspect(msg));

    var zone_event = eventRE.exec(msg._routingKey);

    var authorizedKeysPath = path.join(
      "/zones/"
      , zone_event[3]
      , '/root/home/'+admin_user+'/.ssh/authorized_keys'
    );

    if (zone_event[1] == 'error') {
      return callback(new Error(msg.error));
    }

    if (zone_event[1] == "zone_ready") {
      console.log("Zone was ready in " + (Date.now() - times[zone_event[3]]) + "ms");

      fs.readFile(authorizedKeysPath, 'utf8', function (error, str) {
        assert.ok(!error, "Error reading authorized_keys file: "+error);
        assert.ok(str.indexOf(data.authorized_keys) !== -1
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
              return parts[1] === data.zonename
              && parts[2] === 'running';
            })
            , "our zone should be in the list");

          console.log("Everyone was ok!");
          q.destroy();
          callback(undefined);
        });
    }
  }

  function queueCreated() {
    // provisioner.event.zone_created.sagan.orlandozone0
    var routing
      = [ 'provisioner.event.*'
        , agent.uuid
        , data.zonename
        , '*'
        ].join('.');

    console.log("Routing was %s", routing);

    q.bind(routing);
    q.subscribeJSON(eventReceived);

    var msg = { data: data };
    times[msg.data.zonename] = Date.now();
    agent.sendCommand('provision', msg,
      function (reply) {
        if (reply.error) {
          console.log("ERROR: " + inspect(reply));
          callback(new Error("Error: " + inspect(reply)));
          return;
        }
      });
  }

};

exports.teardownZone = function (agent, data, callback) {
  var q;

  function eventReceived(msg) {
    console.log("EVENT -->");
    console.dir(msg);
    var zone_event = eventRE.exec(msg._routingKey);

    if (zone_event[1] == "zone_destroyed") {
      q.destroy();
      callback(undefined);
    }
  };

  function queueCreated() {
    var routing = 'provisioner.event.zone_destroyed.' + agent.uuid + '.'+data.zonename+'.*';
    console.log("Routing was %s", routing);

    q.bind(routing);
    q.subscribeJSON(eventReceived);

    var msg = { data: data };
    agent.sendCommand
      ( 'teardown'
      , msg
      , function (reply) {
          assert.equal(reply.error
            , undefined,
              "Error should be unset, but was '"
              + inspect(reply.error) + "'.");
          console.log("Zone destruction initiated");
        }
      );
  }

  q = agent.connection.queue(data.zonename + '_teardown_events', queueCreated);
}

// exports.teardownZone = function (agent, data, callback) { 
// 
// };

var zoneadmListFields = ['zoneid', 'zonename', 'state', 'zonepath', 'uuid', 'brand', 'ip-type'];
var zoneadmListFieldCount = zoneadmListFields.length;

exports.zoneadmList = function (callback) {
  function onZoneadmList(error, stdout, stderr) {
    if (error) return callback(error);
    console.log("Listed -->" + stdout);

    var zones = {};
    var lines = stdout.split("\n");
    var i = lines.length;
    var parts;

    while (i--) {
      if (!lines[i]) continue;
      parts = lines[i].split(':');

      var j = zoneadmListFieldCount
      var zonename = parts[1];
      zones[zonename] = {};
      while (j--) {
        var field = zoneadmListFields[j];
        zones[zonename][field] = parts[j];
      }
    }
    callback(undefined, zones);
  }

  execFile('/usr/sbin/zoneadm', ['list', '-pi'], onZoneadmList);
};

exports.zoneBootTime = function (zonename, callback) {
  execFile
    ( '/usr/sbin/zlogin'
    , [zonename, '/usr/bin/kstat', '-p', 'unix:0:system_misc:boot_time']
    , function (error, stdout, stderr) {
        if (error) throw stderr.toString();;
        var kv = stdout.toString().split(/\s+/);
        console.log(sys.inspect(kv));
        callback(undefined, kv[1]);
      });
}

exports.prctl = function (zonename, resourceControlName, callback) {
  execFile
    ( "/usr/bin/prctl"
    , [ '-P', '-t', 'privileged'
      , '-n', resourceControlName
      , '-i', 'zone', zonename
      ]
    , function (error, stdout, stderr) { 
        var parts = stdout.toString().trim().split("\n");
        var zone = parts[parts.length -1].split(/\s+/);
        callback(null, zone);
      }
    );
}

exports.zfsProperties = function (propertyNames, datasets, callback) {
  var fields = ['name','property','value'];
  var args = ['get', '-H', '-o', fields.join(','),
              propertyNames.join(',')];

  // extend the args array with the passed in datasets
  args.splice.apply(
    args,
    [args.length, datasets.length].concat(datasets));

  execFile(
    '/usr/sbin/zfs',
    args,
    function (error, stdout, stderr) {
      if (error) return callback(error);
      callback(null, parseZFSUsage(fields, stdout));
    });
}

function parseZFSUsage (fields, data) {
  var results = {};
  var fieldsLength = fields.length;
  var lines = data.trim().split("\n");
  var i = lines.length;
  while (i--) {
    var line = lines[i].split(/\s+/);
    if (!results[line[0]]) results[line[0]] = {};
    results[line[0]][line[1]] = line[2];
  }

  return results;
}

exports.uuid = process.env['SERVER_UUID'];
exports.setupSuiteAgentHandle = function (suite, callback) {
  console.log("Using " + exports.uuid + " as the server UUID.");
  // Store our agent handle in this object from the closure so that we can
  // access the handle accross test-methods. We cannot use `this` to
  // persist values from one setup-test-teardown to another.
  var store = {};
  suite.setup(function (finished, test) {
    var self = this;

    var uuid = exports.uuid;
    self.client = store.client;

    if (self.client) {
      self.client.getAgentHandle
        ( uuid
        , 'provisioner'
        , getAgentHandleCallback
        );
    }
    else {
      var config = { timeout: 40000, reconnect: false };
      self.client = store.client = new ProvisionerClient(config);
      self.client.connect(function () {
        self.client.getAgentHandle(uuid, 'provisioner', getAgentHandleCallback);
      });
    }

    function getAgentHandleCallback (agentHandle) {
      self.agent = agentHandle;
      finished();
    }
  })

  callback && callback();
}
