var testCase = require('nodeunit').testCase;
var async = require('async');
var Client = require('task_agent/lib/client');
var testcommon = require('./lib/common');
var libcommon = require('../lib/common');
var VM = require('VM');

module.exports = testCase({
    setUp:
        function (callback) {
            var self = this;
            self.msg = testcommon.provisionRequest();
            testcommon.createClient(function (handle) {
                console.log('Should get handle');
                self.handle = handle;
                callback();
            });
        },
    tearDown:
        function (callback) {
            var self = this;
            testcommon.destroyZone(self.msg.zonename, function () {
                self.handle.connection.end();
                callback();
            });
        },
    'Reboot a zone': test_reboot
});

function test_reboot(test) {
    var self = this;

    async.waterfall([
        createZone.bind(self),
        function (callback) {
            setTimeout(callback, 10000);
        },
        function (callback) {
            testcommon.zoneBootTime(
                self.msg.zonename,
                function (error, bootTime) {
                    test.equal(
                        error, undefined,
                        'No error checking machine boot time');

                    self.zoneBootTime1 = bootTime;
                    console.log('Boottime 1 was ' + bootTime);
                    callback();
                });
        },
        rebootZone.bind(self),
        function (callback) {
            VM.waitForZoneState(
                { zonename: self.msg.zonename,  uuid: self.msg.zonename },
                'running',
                { timeout: 30 },
                callback);
        },
        function (callback) {
            testcommon.zoneBootTime(
                self.msg.zonename, function (error, bootTime) {
                    test.equal(
                        error, undefined,
                        'No error checking machine boot time');

                    self.zoneBootTime2 = bootTime;
                    console.log('Boottime 2 was ' + bootTime);
                    callback();
                });
        },
        checkZone.bind(self)
    ],
    function (error) {
        console.dir(arguments);
        test.equal(error, null, 'No errors raised during waterfall');
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
                }
            });
        });
    }

    function rebootZone(callback) {
        var rebootmsg = {
            uuid: self.msg.uuid
        };
        self.handle.sendTask(
            'machine_reboot', rebootmsg, function (taskHandle) {
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
                }
            });
        });
    }

    function checkZone(callback) {
        // get the boot time on the zone before
        testcommon.zoneadmList(function (error, zones) {
            test.equal(
                error, undefined,
                'No error checking zoneadm');

            var zoneid = zones[self.msg.zonename].zoneid;

            console.log('zone id is ' + zoneid);

            test.ok(
                self.zoneBootTime2 > self.zoneBootTime1,
                'Zone\'s second boot timestamp should exceed first the first:'
                + ' ' + self.zoneBootTime2 + ' vs ' + self.zoneBootTime1);
            test.done();
        });
    }
}
