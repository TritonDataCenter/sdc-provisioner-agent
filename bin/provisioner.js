#!/usr/node/bin/node

var TaskAgent = require('../lib/task_agent/task_agent');
var path = require('path');
var createTaskDispatchFn = require('../lib/task_agent/dispatch').createTaskDispatchFn;
var createHttpTaskDispatchFn = require('../lib/task_agent/dispatch').createHttpTaskDispatchFn;
var os = require('os');
var exec = require('child_process').exec;
var tty = require('tty');
var once = require('once');
var bunyan = require('bunyan');

var Provisioner = require('../lib/provisioner');

var logname = 'provisioner';

var log = bunyan.createLogger({ name: logname });

var options = {
    log: log,
    tasklogdir: '/var/log/provisioner/logs',
    logname: 'provisioner',
    use_system_config: true,
    tasksPath: path.join(__dirname, '..', 'lib/tasks'),
    reconnect: true,
    resource: 'provisioner',
    use_system_config: true
};

var provisioner = new Provisioner(options);
provisioner.start();
