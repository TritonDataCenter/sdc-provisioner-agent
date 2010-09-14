exports.provisionZone = function (agent, data, callback) {
  var successCount = 0;

  function eventReceived(msg) {
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
        callback(null);
      });
    }
  }

  var times = {};
  var zonesCreated = [];

  // The agent will emit events as it progresses through the zone creation
  // process. Make sure that the right number and types of events come in.
  var eventRE = /^provisioner\.event\.([^\.]+).([^\.]+).([^\.]+)/;

  var q;

  function queueCreated() {
    // provisioner.event.zone_created.sagan.orlandozone0
    var routing = 'provisioner.event.*.' + agent.hostname + '.*.*';
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

  q = agent.connection.queue(data.zonename + '_events', queueCreated);
}
