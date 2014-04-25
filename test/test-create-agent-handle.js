var testCase = require('nodeunit').testCase;
var common = require('./lib/common');
var Client = require('../lib/task_agent/client');

module.exports = testCase({
    setUp: function (callback) {
        var self = this;

        common.createClient(function (handle) {
            console.log('Should get handle');
            self.handle = handle;
            callback();
        });
    },
    tearDown: function (callback) {
        var self = this;
        self.handle.connection.end();
        // clean up
        callback();
    },
    test1: function (test) {
        test.done();
    }
});
