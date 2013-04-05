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

function keysToUpper(obj) {
    var upperObj = {};
    var keys = Object.keys(obj);
    var i = keys.length;
    while (i--) {
        upperObj[keys[i].toUpperCase().replace(/[^A-Za-z0-9_]/, '_')]
        = obj[keys[i]];
    }
    return upperObj;
}

var FIELDS = 'zoneid:zonename:state:zonepath:uuid:brand:ip-type'.split(':');

function parseZoneList(data) {
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
}

function zoneList(name, callback) {
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
}

function modifyConfig(configPath, key, value, callback) {
    var out = [];
    var found = false;

    fs.readFile(configPath, 'utf8', function (error, data) {
        data.toString().split('\n').forEach(function (l) {
            var idx = l.indexOf('=');
            var lk = l.slice(0, idx);

            if (lk === 'overprovision_ratio') {
                found = true;
                out.push('overprovision_ratio=\''+value+'\'');
            } else {
                out.push(l);
            }
        });

        if (!found) {
            out.push('overprovision_ratio=\''+value+'\'');
        }

        fs.writeFile(configPath, out.join('\n'), 'utf8', function (writeError) {
            callback(writeError);
        });
    });
}

function zoneadm(zone, addtlArgs, callback) {
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
}

function zonecfg(zone, addtlArgs, callback) {
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
}

function halt(zone, callback) {
    zoneadm(zone, ['halt', '-X'], callback);
}

function disableAutoboot(zone, callback) {
    zonecfg(zone, ['set', 'autoboot=false'], callback);
}

function enableAutoboot(zone, callback) {
    zonecfg(zone, ['set', 'autoboot=true'], callback);
}

function boot(zone, callback) {
    zoneadm(zone, ['boot', '-X'], callback);
}

function uninstallZone(zone, callback) {
    zoneadm(zone, ['uninstall', '-F'], callback);
}

function deleteZone(zone, callback) {
    zonecfg(zone, ['delete', '-F'], callback);
}


function destroyZone(zone, callback) {
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
}

function logParseTrace(trace, logger) {
    if (typeof (trace) === 'object') {
        for (var i in trace) {
            var item = trace[i];
            var timestamp = item.timestamp;

            delete item.timestamp;

            logger.logMessage('info', item, timestamp);
        }
    }
}

function zpoolFromZoneName(zonename, callback) {
    Zone.get(zonename, function (error, zone) {
        console.dir(zone);
        var zpool = zone.zonepath.slice(1).split('/', 1)[0];
        return callback(null, zpool);
    });
}

function setZoneAttribute(zone, name, value, callback) {
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
}

function makeVmadmLogger(task) {
    // XXX this logging is a hack to get us past the change for VM.js using
    // bunyan. Needs to be rewritten before SDC7.

    // XXX this can be replaced with bunyan.safeCycles if needed when we have it
    function safeCycles() {
        var seen = [];
        return function (key, val) {
            if (!val || typeof (val) !== 'object') {
                return val;
            }
            if (seen.indexOf(val) !== -1) {
                return '[Circular]';
            }
            seen.push(val);
            return val;
        };
    }

    function logToTask() {
        this.write = function (rec) {
            var err;
            var str;
            var level;

            // XXX levels hardcoded from bunyan
            // var TRACE = 10;
            // var DEBUG = 20;
            // var INFO = 30;
            // var WARN = 40;
            // var ERROR = 50;
            // var FATAL = 60;
            switch (rec.level) {
                case 60:
                case 50:
                case 40:
                    level = 'error';
                    break;
                default:
                    level = 'info';
                    break;
            }
            str = JSON.stringify(rec, safeCycles());
            console.log('logging "' + str + '" to ' + level);
            task.log[level](str);
            if (rec.err) {
                err = rec.err;
                task.log.error(err.message
                    + (err.stack ? + ':' + err.stack : ''));
            }
        };
    }

    return {
        type: 'raw',
        stream: new logToTask(),
        level: 'debug'
    };
}

function createMachineInProgressFile(uuidOrZonename, callback) {
    var filename = '/var/tmp/machine-creation-' + uuidOrZonename;
    fs.writeFile(filename, '', function (error) {
        return callback(error, filename);
    });
}

function ensureCreationComplete(uuid, callback) {
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
}

module.exports = {
    ensureCreationComplete: ensureCreationComplete,
    createMachineInProgressFile: createMachineInProgressFile,
    makeVmadmLogger: makeVmadmLogger,
    setZoneAttribute: setZoneAttribute,
    zpoolFromZoneName: zpoolFromZoneName,
    logParseTrace: logParseTrace,
    destroyZone: destroyZone,
    deleteZone: deleteZone,
    uninstallZone: uninstallZone,
    boot: boot,
    enableAutoboot: enableAutoboot,
    disableAutoboot: disableAutoboot,
    zonecfg: zonecfg,
    zoneadm: zoneadm,
    modifyConfig: modifyConfig,
    zoneList: zoneList,
    parseZoneList: parseZoneList,
    keysToUpper: keysToUpper
};
