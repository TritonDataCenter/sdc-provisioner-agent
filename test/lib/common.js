var execFile = require('child_process').execFile;
var fakekeys = require('./fakekeys');
var libcommon = require('../../lib/common');
var Client = require('task_agent/lib/client');

exports.testZoneDataset = 'zones/' + exports.testZoneName;

exports.provisionRequest = function (vars) {
    vars = vars || {};
    var uuid = '2e4a24af-97a2-4cb1-a2a4-1edb209fb311';
    var defaults = {
        'image_uuid': 'bb6d5a10-c330-11e0-8f18-9fbfcd26660b',
        'do_not_inventory': true,
        'root_pw': 'therootpw',
        'owner_uuid': 'this-is-my-uuid',
        'uuid': uuid,
        'zonename': uuid,
        'ram_in_bytes': 1073741824,
        'nics':  [
            { ip: '10.88.88.75',
                nic: 'external',
                mac: '90:b8:d0:86:b2:8c',
                netmask: '255.255.255.0',
                vlan_id: 0,
                nic_tag: 'external',
                gateway: '10.88.88.2',
                interface: 'net0'
            }
        ]
    };

    var keys = Object.keys(defaults);
    for (var i = 0; i < keys.length; i++) {
        if (vars[keys[i]] === undefined) {
            vars[keys[i]] = defaults[keys[i]];
        }
    }

    return vars;
};

exports.destroyZone = libcommon.destroyZone;

exports.createClient = function (callback) {
    var client = new Client({ attemptToReconnect: false, log: console });

    client.config.use_system_config = true;
    client.configureAMQP(function () {
        client.connect(function () {
            console.log('Connected!');
            client.getAgentHandle(
                'provisioner-v2',
                client.uuid,
                function (handle) {
                    console.log('Got agent handle: ' + handle.clientId);
                    callback(handle);
                });
        });
    });
};

exports.zoneBootTime = function (zonename, callback) {
    execFile(
        '/usr/sbin/zlogin',
        [ zonename, '/usr/bin/kstat', '-p', 'unix:0:system_misc:boot_time' ],
        function (error, stdout, stderr) {
            if (error) {
                throw stderr.toString();
            }
            var kv = stdout.toString().split(/\s+/);
            console.dir(kv);
            return callback(undefined, kv[1]);
        });
};

var zoneadmListFields = [
    'zoneid', 'zonename', 'state',
    'zonepath', 'uuid', 'brand', 'ip-type'
];

var zoneadmListFieldCount = zoneadmListFields.length;

exports.zoneadmList = function (callback) {
    function onZoneadmList(error, stdout, stderr) {
        if (error) {
            return callback(error);
        }
        console.log('Listed -->' + stdout);

        var zones = {};
        var lines = stdout.split('\n');
        var i = lines.length;
        var parts;

        while (i--) {
            if (!lines[i]) {
                continue;
            }
            parts = lines[i].split(':');

            var j = zoneadmListFieldCount;
            var zonename = parts[1];
            zones[zonename] = {};
            while (j--) {
                var field = zoneadmListFields[j];
                zones[zonename][field] = parts[j];
            }
        }
        return callback(undefined, zones);
    }

    execFile('/usr/sbin/zoneadm', ['list', '-pi'], onZoneadmList);
};

exports.prctl = function (zonename, resourceControlName, callback) {
    execFile(
        '/usr/bin/prctl',
        [
            '-P', '-t', 'privileged',
            '-n', resourceControlName,
            '-i', 'zone', zonename
        ],
        function (error, stdout, stderr) {
            var parts = stdout.toString().trim().split('\n');
            var zone = parts[parts.length -1].split(/\s+/);
            return callback(null, zone);
        });
};
