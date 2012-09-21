var testCase = require('nodeunit').testCase;
var async = require('async');
var common = require('./lib/common');
var VM = require('VM');

module.exports = testCase({
    setUp:
        function (callback) {
            var self = this;
            self.msg = common.provisionRequest();
            self.msg.ram = 128;
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
    'Resize a zone': test_zone_resize
});

function test_zone_resize(test) {
    var self = this;

    var newRam = (256+Math.floor(Math.random()*100));
    async.waterfall([
        createZone.bind(self),
        function (callback) {
            setTimeout(function () {
                callback();
            }, 10000);
        },
        resizeZone.bind(self),
        checkZone.bind(self)
    ],
    function (error) {
        test.equal(error, undefined, 'No errors raised during waterfall');
        return test.done();
    });

    function createZone(callback) {
        self.handle.sendTask('machine_create', self.msg, function (taskHandle) {
            console.log('Inside the sendTask callback');
            taskHandle.on('event', function (eventName, msg) {
                console.log('Saw event ' + eventName);
                test.notEqual(
                    eventName, 'error',
                    'Event type was not error');
                test.equal(
                    msg.error, undefined,
                    'No error received');
                if (eventName == 'finish') {
                    callback();
                }
            });
        });
    }

    function resizeZone(callback) {
        var resizemsg = {
            uuid: self.msg.uuid,
            max_physical_memory: newRam,
            max_swap: newRam * 2,
            package_name: 'jibba',
            package_version: '1.0.0'
        };
        self.handle.sendTask(
            'machine_update', resizemsg, function (taskHandle) {
            console.log('Inside the sendTask callback');
            taskHandle.on('event', function (eventName, msg) {
                console.log('Saw event ' + eventName);
                test.notEqual(
                    eventName, 'error',
                    'Event type was not error');
                test.equal(
                    msg.error, undefined,
                    'No error received');
                if (eventName == 'finish') {
                    callback();
                }
            });
        });
    }

    function checkZone(callback) {
        VM.lookup(
            { uuid: self.msg.uuid },
            { full: true },
            function (error, machines) {
                var zone = machines[0];

                test.equal(
                    zone.max_physical_memory, newRam,
                    'max_physical_memory resized');
                test.equal(
                    zone.max_swap, newRam * 2,
                    'max_swap resized');
                test.equal(
                    zone.package_name, 'jibba',
                    'package_name updated');
                test.equal(
                    zone.package_version, '1.0.0',
                    'package_version updated');

                return callback();
        });
    }
}
