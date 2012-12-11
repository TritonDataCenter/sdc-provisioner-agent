#!/usr/node/bin/node

var TaskAgent = require('task_agent/lib/task_agent');
var path = require('path');
var createTaskDispatchFn
= require('task_agent/lib/dispatch').createTaskDispatchFn;
var os = require('os');
var tty = require('tty');

var tasksPath = path.join(__dirname, '..', 'lib/tasks');

var options = {
    tasklogdir: '/var/log/provisioner',
    logname: 'provisioner',
    use_system_config: true,
    tasksPath: tasksPath,
    reconnect: true,
    resource: 'provisioner',
    use_system_config: true
};

var agent = new TaskAgent(options);

var queueDefns = [
    {
        name: 'machine_creation',
        log: true,
        maxConcurrent: os.cpus().length,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        tasks: [ 'machine_create' ]
    },
    {
        name: 'machine_tasks',
        log: true,
        maxConcurrent: os.cpus().length,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        tasks: [
            'machine_boot',
            'machine_destroy',
            'machine_reboot',
            'machine_shutdown',
            'machine_update',
            'machine_screenshot',
            'machine_create_snapshot',
            'machine_rollback_snapshot',
            'machine_delete_snapshot'
        ]
    },
    {
        name: 'machine_query',
        expires: 60, // expire messages in this queue after a minute
        log: true,
        maxConcurrent: 64,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        tasks: [
            'machine_load',
            'machine_info'
        ]
    },
    {
        name: 'zfs_tasks',
        log: true,
        maxConcurrent: os.cpus().length,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        tasks: [
            'zfs_create_dataset',
            'zfs_destroy_dataset',
            'zfs_rename_dataset',
            'zfs_snapshot_dataset',
            'zfs_rollback_dataset',
            'zfs_clone_dataset',
            'zfs_set_properties'
        ]
    },
    {
        name: 'zfs_query',
        log: true,
        maxConcurrent: os.cpus().lenth,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        tasks: [
            'zfs_get_properties',
            'zfs_list_datasets',
            'zfs_list_snapshots',
            'zfs_list_pools'
        ]
    },
    {
        name: 'fw_tasks',
        log: true,
        maxConcurrent: 1,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        tasks: [
            'fw_add',
            'fw_del',
            'fw_update'
        ]
    },
    {
        name: 'test_sleep',
        log: true,
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
    agent.on('ready', function () {
      agent.setupQueues(queueDefns);
    });
    agent.connect();
});
