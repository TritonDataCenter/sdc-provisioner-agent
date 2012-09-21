#!/usr/node/bin/node

var TaskAgent = require('task_agent/lib/task_agent');
var path = require('path');
var createTaskDispatchFn
= require('task_agent/lib/dispatch').createTaskDispatchFn;
var os = require('os');
var log4js = require('log4js');
var tty = require('tty');

log4js.clearAppenders();
var isatty = tty.isatty(process.stdout.fd);
log4js.addAppender(
    log4js.consoleAppender(
        isatty ? log4js.colouredLayout : log4js.basicLayout));

var tasksPath = path.join(__dirname, '..', 'lib/tasks');

var options = {
    use_system_config: true,
    tasksPath: tasksPath,
    reconnect: true,
    resource: 'provisioner',
    log4js: log4js,
    use_system_config: true
};

var agent = new TaskAgent(options);

var queueDefns = [
    {
        name: 'machine_creation',
        maxConcurrent: os.cpus().length,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        tasks: [ 'machine_create' ]
    },
    {
        name: 'machine_tasks',
        maxConcurrent: os.cpus().length,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        tasks: [
            'machine_boot',
            'machine_destroy',
            'machine_info',
            'machine_reboot',
            'machine_shutdown',
            'machine_update',
            'machine_load',
            'machine_screenshot'
        ]
    },
    {
        name: 'zfs_tasks',
        maxConcurrent: os.cpus().length,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        tasks: [
            'zfs_create_dataset',
            'zfs_destroy_dataset',
            'zfs_list_datasets',
            'zfs_rename_dataset',
            'zfs_snapshot_dataset',
            'zfs_rollback_dataset',
            'zfs_clone_dataset',

            'zfs_get_properties',
            'zfs_set_properties',

            'zfs_list_pools'
        ]
    },
    {
        name: 'test_sleep',
        maxConcurrent: 3,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        tasks: [ 'sleep' ]
    },
    {
        name: 'nop',
        maxConcurrent: 1,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        tasks: [ 'nop' ]
    },
    {
        name: 'test_subtask',
        maxConcurrent: 3,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        tasks: [ 'test_subtask' ]
    },
    {
        name: 'metering',
        maxConcurrent: 3,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        tasks: [ 'meter_query' ]
    }
];

agent.configureAMQP(function () {
    console.dir(agent.config);
    agent.on('ready', function () {
      agent.setupQueues(queueDefns);
    });
    agent.connect();
});
