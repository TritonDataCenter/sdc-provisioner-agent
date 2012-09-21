var testCase = require('nodeunit').testCase;
var async = require('async');
var util = require('util');
var Client = require('task_agent/lib/client');
var common = require('./lib/common');
var fs = require('fs');
var path = require('path');
var Zone = require('tracker/lib/zone');

module.exports = testCase({
    setUp: function (callback) {
        var self = this;
        self.msg = common.provisionRequest();
        self.msg.zfs_io_priority = 42;
        self.msg.customer_metadata = {
            dancing: 'FORBIDDEN'
        };

        common.createClient(function (handle) {
            console.log('Should get handle');
            self.handle = handle;
            callback();
        });
    },
    tearDown: function (callback) {
        var self = this;
        common.destroyZone(self.msg.zonename, function () {
            self.handle.connection.end();
            callback();
        });
    },
    'Create a machine': function (test) {
        var self = this;
        var task = 'machine_create';
        self.handle.sendTask(task, self.msg, function (taskHandle) {
            taskHandle.on('event', function (eventName, msg) {
                console.log('Saw event ' + eventName);
                test.notEqual(
                    eventName, 'error',
                    'Event type was not error');
                test.equal(
                    msg.error, undefined,
                    'No error received');
                if (eventName == 'finish') {
                    console.log('machine_create succeeded');
                }
            });
        });
        setTimeout(function () {
            var destroyMsg = { uuid: self.msg.uuid };
            self.handle.sendTask(
                'machine_destroy',
                destroyMsg,
                function (taskHandle) {
                    taskHandle.on('event', function (eventName, msg) {
                        console.log('Saw event ' + eventName);
                        test.notEqual(
                            eventName, 'error',
                            'Event type was not error');
                        test.equal(
                            msg.error, undefined,
                            'No error received');
                        if (eventName == 'finish') {
                            common.zoneadmList(function (error, zones) {
                                console.dir(zones);
                                test.done();
                            });
                        }
                    });
                });
        }, 5000);
    }
});
