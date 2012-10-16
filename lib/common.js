/*
 *
 * Common functions that don't belong anywhese else.
 *
 */

var fs = require('fs');
var execFile = require('child_process').execFile;
var async = require('async');
var Zone = require('tracker/lib/zone');
var VM = require('VM');

/**
 *
 * Returns a copy of an object withs keys upper-cased.
 *
 * @param obj {Object}
 *   Covert the keys of `obj` to uppercase and return new object.
 *
 */

module.exports.keysToUpper = function (obj) {
    var upperObj = {};
    var keys = Object.keys(obj);
    var i = keys.length;
    while (i--) {
        upperObj[keys[i].toUpperCase().replace(/[^A-Za-z0-9_]/, '_')]
        = obj[keys[i]];
    }
    return upperObj;
};

var FIELDS = 'zoneid:zonename:state:zonepath:uuid:brand:ip-type'.split(':');

var parseZoneList = module.exports.parseZoneList = function (data) {
    var zones = {};
    var lines = data.trim().split('\n');
    var i = lines.length;
    var j;
    var zone;
    var fieldsLength = FIELDS.length;

    while (i--) {
        var lineParts = lines[i].split(':');
        var zoneName = lineParts[1];
        j = fieldsLength;
        zones[zoneName] = zone = {};

        while (j--) {
            zone[FIELDS[j]] = lineParts[j];
        }
    }

    return zones;
};

var zoneList = module.exports.zoneList = function (name, callback) {
    var args = [ 'list', '-pc' ];

    if (name) {
        args.push(name);
    }

    execFile('/usr/sbin/zoneadm', args, function (error, stdout, stderr) {
        if (error) {
            return callback(error);
        }
        return callback(null, exports.parseZoneList(stdout));
    });
};

var zoneadm = module.exports.zoneadm = function (zone, addtlArgs, callback) {
    var args = ['-z', zone];
    args.push.apply(args, addtlArgs);
    execFile('/usr/sbin/zoneadm', args, { encoding: 'utf8' },
        function (error, stderr, stdout) {
            if (error) {
                callback(
                    new Error(
                        'Error running zoneadm '
                        + addtlArgs.join(' ')
                        + ' on zone: '
                        + stderr.trim()));
                return;
            }
            callback();
            return;
        });
};

var zonecfg = module.exports.zonecfg = function (zone, addtlArgs, callback) {
    var args = ['-z', zone];
    args.push.apply(args, addtlArgs);
    execFile('/usr/sbin/zonecfg', args, { encoding: 'utf8' },
        function (error, stderr, stdout) {
            if (error) {
                return callback(
                    new Error(
                        'Error running zonecfg ' + addtlArgs.join(' ')
                        + ' on zone: ' + stderr.trim()));
            }
            return callback();
        });
};

var halt = module.exports.halt = function (zone, callback) {
    zoneadm(zone, ['halt', '-X'], callback);
};

var disableAutoboot =
module.exports.disableAutoboot =
function (zone, callback) {
    zonecfg(zone, ['set', 'autoboot=false'], callback);
};

var enableAutoboot = module.exports.enableAutoboot = function (zone, callback) {
    zonecfg(zone, ['set', 'autoboot=true'], callback);
};

var boot = module.exports.boot = function (zone, callback) {
    zoneadm(zone, ['boot', '-X'], callback);
};

var uninstallZone = module.exports.uninstallZone = function (zone, callback) {
    zoneadm(zone, ['uninstall', '-F'], callback);
};

var deleteZone = module.exports.deleteZone = function (zone, callback) {
    zonecfg(zone, ['delete', '-F'], callback);
};


module.exports.destroyZone = function (zone, callback) {
    console.log('Attempting to destroy zone');
    async.waterfall([
        // async.apply(disableAutoboot, zone),
        async.apply(halt, zone),
        async.apply(uninstallZone, zone),
        async.apply(deleteZone, zone)
    ],
    function (error) {
        if (error) {
            console.log('Error destroying zone: ' + error);
            return callback(error);
        }
        return callback();
    });
};

module.exports.logParseTrace = function (trace, logger) {
    if (typeof (trace) === 'object') {
        for (var i in trace) {
            var item = trace[i];
            var timestamp = item.timestamp;

            delete item.timestamp;

            logger.logMessage('info', item, timestamp);
        }
    }
};

module.exports.zpoolFromZoneName = function (zonename, callback) {
    Zone.get(zonename, function (error, zone) {
        console.dir(zone);
        var zpool = zone.zonepath.slice(1).split('/', 1)[0];
        return callback(null, zpool);
    });
};

module.exports.setZoneAttribute = function (zone, name, value, callback) {
    var rmAttrArgs = [
        [
            'remove attr name=' + name,
            'commit'
        ].join('; ')
    ];

    var addAttrArgs = [
        [
            'add attr; set name="'+name+'"',
            'set type=string',
            'set value="'+value+'"',
            'end',
            'commit'
        ].join('; ')
    ];

    zonecfg(zone, rmAttrArgs, function () {
        if (value && value.toString()) {
            zonecfg(zone, addAttrArgs, function (error) {
                return callback(error);
            });
        } else {
            callback();
        }
    });
};

module.exports.makeVmadmLogger = function (task) {
    return function (priority, message, err) {
        var level = priority.toLowerCase();
        switch (level) {
            case 'emerg':
            case 'alert':
            case 'crit':
                level = 'error';
                break;
            case 'notice':
                level = 'info';
                break;
            default:
                level = 'info';
                break;
        }
        task.log[level](message);
        if (err) {
            task.log.error(err.message + (err.stack ? + ':' + err.stack : ''));
        }
    };
};

module.exports.createMachineInProgressFile =
function (uuidOrZonename, callback) {
    var filename = '/var/tmp/machine-creation-' + uuidOrZonename;
    fs.writeFile(filename, '', function (error) {
        return callback(error, filename);
    });
};

module.exports.ensureCreationComplete =
function (uuid, callback) {
    var filename = '/var/tmp/machine-creation-' + uuid;
    var expiresAt;
    var timeoutMinutes = 10;

    function checkIfReady() {
        fs.exists(filename, function (exists) {
            if (!exists) {
                return callback();
            }

            return async.waterfall([
                function (wf$callback) {
                    if (!expiresAt) {
                        fs.stat(filename, function (error, stats) {
                            expiresAt =
                                timeoutMinutes * 60 * 1000 + stats.ctime;
                            return wf$callback(error);
                        });
                    }
                    return wf$callback();
                }
            ],
            function (error) {
                // Check if we exceeded the timeout duration.
                var now = Number(new Date());
                if (now > expiresAt) {
                    fs.unlink(filename, function () {
                        return callback();
                    });
                } else {
                    setTimeout(checkIfReady, 10 * 1000);
                }
            });
        });
    }

    checkIfReady();
};
