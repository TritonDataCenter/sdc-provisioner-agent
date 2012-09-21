var testCase = require('nodeunit').testCase;
var async = require('async');
var Client = require('task_agent/lib/client');
var common = require('./lib/common');
var execFile = require('child_process').execFile;

module.exports = testCase({
    setUp:
        function (callback) {
            var self = this;
            self.msg = common.provisionRequest();
            common.createClient(function (handle) {
                self.handle = handle;
                callback();
            });
        },
    tearDown:
        function (callback) {
            var self = this;
            common.destroyZone(self.msg.uuid, function () {
                self.handle.connection.end();
                callback();
            });
        },
    'Shutdown a zone': test_shutdown
});

function test_shutdown(test) {
    var self = this;

    async.waterfall([
        createZone.bind(self),
        function (callback) {
            common.zoneBootTime(self.msg.uuid, function (error, bootTime) {
                test.equal(
                    error, undefined,
                    'Did not get an error checking zone boot time');
                self.zoneBootTime1 = bootTime;
                console.log('Boottime 1 was ' + bootTime);
                return callback();
            });
        },
        shutdownZone.bind(self),
        function (callback) {
            setTimeout(function () {
                callback();
            }, 10000);
        },
        function (callback) {
            assertAutoboot(false, function () {
                callback();
            });
        },
        bootZone.bind(self),
        function (callback) {
            setTimeout(function () {
                callback();
            }, 20000);
        },
        function (callback) {
            common.zoneBootTime(self.msg.uuid, function (error, bootTime) {
                test.equal(
                    error, undefined,
                    'Did not get an error checking zone boot time');
                self.zoneBootTime2 = bootTime;
                console.log('Boottime 2 was ' + bootTime);
                callback();
            });
        },
        checkZone.bind(self),
        function (callback) {
            assertAutoboot(true, function () {
                callback();
            });
        }
    ],
    function (error) {
        test.equal(error, undefined, 'No errors raised during waterfall');
        return test.done();
    });

    function createZone(callback) {
        self.handle.sendTask('machine_create', self.msg, function (taskHandle) {
            console.log('Inside the sendTask callback');
            taskHandle.on('event', function (eventName, msg) {
                test.notEqual(
                    eventName, 'error',
                    'Event type was not error');
                test.equal(
                    msg.error, undefined,
                    'No error received');
                console.log('Saw event ' + eventName);
                if (eventName == 'finish') {
                    callback();
                } else if (eventName == 'error') {
                    callback();
                }
            });
        });
    }

    function shutdownZone(callback) {
        var msg = {
            uuid: self.msg.uuid
        };
        self.handle.sendTask('machine_shutdown', msg, function (taskHandle) {
            taskHandle.on('event', function (eventName, event$msg) {
                test.notEqual(
                    eventName, 'error',
                    'Event type was not error');
                test.equal(
                    event$msg.error, undefined,
                    'No error received');
                console.log('Saw event ' + eventName);
                if (eventName == 'finish') {
                    callback();
                }
            });
        });
    }

    function assertAutoboot(val, callback) {
        execFile(
            '/usr/sbin/zonecfg',
            [ '-z', self.msg.uuid, 'info' ],
            function (error, stdout, stderr) {
                console.dir(arguments);
                var lines = stdout.toString().split('\n');
                var found = lines.filter(function (i) {
                    return i.match(new RegExp('^autoboot:\\s+'+val));
                });
                test.ok(found.length > 0, 'Found the autoboot zone attribute');
                callback();
            });
    }

    function bootZone(callback) {
        var msg = {
            uuid: self.msg.uuid
        };
        self.handle.sendTask('machine_boot', msg, function (taskHandle) {
            taskHandle.on('event', function (eventName, event$msg) {
                test.notEqual(
                    eventName, 'error',
                    'Event type was not error');
                test.equal(
                    event$msg.error, undefined,
                    'No error received');
                console.log('Saw event ' + eventName);
                if (eventName == 'finish') {
                    callback();
                }
            });
        });
    }

    function checkZone(callback) {
        // get the boot time on the zone before
        common.zoneadmList(function (error, zones) {
            test.equal(
                error, undefined,
                'No error checking zoneadm');

            test.ok(
                self.zoneBootTime2 > self.zoneBootTime1,
                'Zone\'s second boot timestamp should exceed first the first');
            callback();
        });
    }
}
