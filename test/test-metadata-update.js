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
        self.msg.customer_metadata = {
            dancing: 'FORBIDDEN'
        };

        common.createClient(function (handle) {
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
    'Create a zone': function (test) {
        var self = this;
        var task = 'machine_create';
        var metadataNew = { aqua: 'unit' };
        async.waterfall([
            function (callback) {
                self.handle.sendTask(task, self.msg, function (taskHandle) {
                    taskHandle.on('event', function (eventName, msg) {
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
            },
            function (callback) {
                self.handle.sendTask(
                    'machine_update',
                    {
                        uuid: self.msg.zonename,
                        set_customer_metadata: metadataNew
                    },
                    function (taskHandle) {
                        taskHandle.on('event', function (eventName, msg) {
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
            },
            function (callback) {
                checkMetadata(function () {
                    callback();
                });
            }
        ],
        function (error) {
            test.equal(error, undefined, 'No errors raised during waterfall');
            test.done();
        });

        function checkMetadata(callback) {
            fs.readFile(
                path.join('/zones', self.msg.zonename, 'config/metadata.json'),
                function (error, data) {
                    var obj = JSON.parse(data.toString());
                    console.dir(obj);
                    test.equals(
                        obj.customer_metadata.aqua, 'unit',
                        'Customer metadata value matched');
                    callback();
                });
        }
    }
});
