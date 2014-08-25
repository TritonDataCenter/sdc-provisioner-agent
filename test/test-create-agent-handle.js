/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

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
