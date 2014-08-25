#!/usr/node/bin/node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var Client = require('../lib/task_agent/client');
var optparse = require('optparse');
var async = require('async');
var fs = require('fs');
var util = require('util');
var path = require('path');
var smartdc_config = require('../lib/smartdc-config');

function parseOptions() {
    // XXX read presets and display them in help message.
    var switches = [
        ['-h', '--help', 'This help'],
        ['-D', '--set NAME=VALUE', 'Override a parameter'],
        ['-f', '--file FILE', 'Read input parameters from this JSON file'],
        ['-p', '--preset PRESET',
            'Read input parameters from preset configuration'],
        ['-r', '--resource RESOURCE',
            'Use RESOURCE as the AMQP resource name'],
        ['-l', '--list-presets', 'List known presets for given task'],
        ['-u', '--uuid UUID',
            'UUID of node to run task on (default to this node)'],
        ['-v', '--verbose', 'Enable verbose logging']
    ];

    var opts = {
        defines: {}
    };

    var parser = new optparse.OptionParser(switches);

    parser.banner = [
        process.argv[0],
        process.argv[1],
        '[options]',
        'task'
    ].join(' ');

    parser.on('file', function (param, value) {
        opts.file = value;
    });

    parser.on('preset', function (param, value) {
        opts.preset = value;
    });

    parser.on('resource', function (param, value) {
        opts.resource = value;
    });

    parser.on('uuid', function (param, value) {
        opts.uuid = value;
    });

    parser.on('list-presets', function () {
        opts.list_presets = true;
    });

    parser.on('help', function () {
        console.log(parser.toString());
        process.exit(0);
    });

    parser.on('verbose', function () {
        opts.verbose = 1;
    });

    parser.on('set', function (param, key_value) {
        var eqlPos = key_value.indexOf('=');
        var key = key_value.slice(0, eqlPos);
        var value = key_value.slice(eqlPos+1, key_value.length);
        opts.defines[key] = value;
    });

    parser.on(2, function (value) {
        opts.task = value;
    });

    var args = parser.parse(process.argv).slice(3);

    if (opts.preset && opts.file) {
        console.error('Error: Only one of --file or --preset may be specified');
        process.exit(1);
    }

    if (opts.verbose) {
        console.warn(opts);
    }

    if (!opts.resource) {
        opts.resource = 'provisioner';
    }


    args.forEach(function (key_value) {
        var eqlPos = key_value.indexOf('=');
        if (eqlPos === -1) {
            console.warn('Couln\'t understand parameter ' + key_value);
            process.exit(1);
        }
        var key = key_value.slice(0, eqlPos);
        var value = key_value.slice(eqlPos+1, key_value.length);
        opts.defines[key] = value;
    });

    return opts;
}

function pad3(n) {
    return String('   ' + n).slice(-3);
}

var options = parseOptions();
var client = new Client({ attemptToReconnect: false, use_system_config: true, log: console });
var resource = options.resource;
var task = options.task;

if (!task) {
    console.warn('No task specified. Use -h option for help.');
    process.exit(1);
}

var uuid;
var msg = {};
var presetObj;
var presetDirPath = path.join(__dirname, '..', 'tasks', task, 'presets');

function merge(a, b) {
    for (var i in b) {
        a[i] = b[i];
    }
}

async.waterfall([
    function (callback) {
        if (options.uuid) {
            uuid = options.uuid;
            callback();
        } else {
            smartdc_config.sysinfo(function (error, sysinfo) {
                uuid = sysinfo.UUID;
                callback();
            });
        }
    },
    function (callback) {
        merge(msg, options.defines);
        callback();
    },
    client.configureAMQP.bind(client),
    function (callback) {
        client.connect(callback);
    },
    function (callback) {
        client.getAgentHandle(resource, uuid, function (handle) {
            if (options.verbose) {
                console.warn(JSON.stringify(msg, null, '  '));
            }

            handle.sendTask(task, msg, function (taskHandle) {
                taskHandle.on('event', function (eventName, event) {
                    function eventProgress(value, progress$event) {
                        if (typeof (value) !== 'undefined') {
                            console.warn(
                                '' + pad3(value) + '% | ' + progress$event);
                        }
                    }
                    var progress;
                    var name = eventName.slice(eventName.indexOf(':')+1);
                    var desc = event.description || name;
                    if (eventName === 'error') {
                        console.error('Received an error: ');
                        console.error(event.error);
                        if (options.verbose && event.details) {
                            console.error('Additional error details: ');
                            console.error(JSON.stringify(event.details));
                        }
                    } else if (eventName.match(/^start:/)) {
                        eventProgress(progress, desc);
                    } else if (eventName.match(/^end:/)) {
                        // TODO this assumes this event is the end of the last
                        // one and we havent missed any. can't happen? maybe.
                        console.warn(' ok\n');
                    } else if (eventName === 'progress') {
                        progress = event.value;
                    } else if (eventName === 'finish') {
                        if (options.verbose) {
                            console.log(JSON.stringify(event, null, '  '));
                        }
                        eventProgress(progress, desc);
                        callback();
                    }
                    return;
                });
            });
        });
    }
],
function (error) {
    client.connection.end();
});
