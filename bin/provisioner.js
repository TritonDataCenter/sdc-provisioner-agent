#!/usr/node/bin/node
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var TaskAgent = require('../lib/task_agent/task_agent');
var path = require('path');
var createTaskDispatchFn = require('../lib/task_agent/dispatch').createTaskDispatchFn;
var createHttpTaskDispatchFn = require('../lib/task_agent/dispatch').createHttpTaskDispatchFn;
var os = require('os');
var exec = require('child_process').exec;
var tty = require('tty');
var once = require('once');
var fs = require('fs');

var tasksPath = path.join(__dirname, '..', 'lib/tasks');

var options = {
    tasklogdir: '/var/log/provisioner/logs',
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
        maxConcurrent: os.cpus().length,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        onhttpmsg: createHttpTaskDispatchFn(agent, tasksPath),
        tasks: [ 'machine_create', 'machine_reprovision' ]
    },
    {
        name: 'image_import_tasks',
        maxConcurrent: 1,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        onhttpmsg: createHttpTaskDispatchFn(agent, tasksPath),
        tasks: [ 'image_ensure_present' ]
    },
    {
        name: 'server_tasks',
        maxConcurrent: os.cpus().length,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        onhttpmsg: createHttpTaskDispatchFn(agent, tasksPath),
        tasks: [
            'server_overprovision_ratio'
        ]
    },
    {
        name: 'server_nic_tasks',
        maxConcurrent: 1,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        onhttpmsg: createHttpTaskDispatchFn(agent, tasksPath),
        tasks: [
            'server_update_nics'
        ]
    },
    {
        name: 'machine_tasks',
        maxConcurrent: os.cpus().length,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        onhttpmsg: createHttpTaskDispatchFn(agent, tasksPath),
        tasks: [
            'machine_boot',
            'machine_destroy',
            'machine_kill',
            'machine_reboot',
            'machine_shutdown',
            'machine_update',
            'machine_update_nics',
            'machine_screenshot',
            'machine_create_snapshot',
            'machine_rollback_snapshot',
            'machine_delete_snapshot'
        ]
    },
    {
        name: 'machine_images',
        expires: 60, // expire messages in this queue after a minute
        maxConcurrent: 64,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        onhttpmsg: createHttpTaskDispatchFn(agent, tasksPath),
        tasks: [
            'machine_create_image'
        ]
    },
    {
        name: 'image_query',
        expires: 60, // expire messages in this queue after a minute
        maxConcurrent: 64,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        onhttpmsg: createHttpTaskDispatchFn(agent, tasksPath),
        logging: false,
        tasks: [
            'image_get'
        ]
    },
    {
        name: 'machine_query',
        expires: 60, // expire messages in this queue after a minute
        maxConcurrent: 64,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        onhttpmsg: createHttpTaskDispatchFn(agent, tasksPath),
        logging: false,
        tasks: [
            'machine_load',
            'machine_info'
        ]
    },
    {
        name: 'zfs_tasks',
        maxConcurrent: os.cpus().length,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        onhttpmsg: createHttpTaskDispatchFn(agent, tasksPath),
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
        maxConcurrent: os.cpus().lenth,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        onhttpmsg: createHttpTaskDispatchFn(agent, tasksPath),
        tasks: [
            'zfs_get_properties',
            'zfs_list_datasets',
            'zfs_list_snapshots',
            'zfs_list_pools'
        ]
    },
    {
        name: 'fw_tasks',
        maxConcurrent: 1,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        onhttpmsg: createHttpTaskDispatchFn(agent, tasksPath),
        tasks: [
            'fw_add',
            'fw_del',
            'fw_update'
        ]
    },
    {
        name: 'test_sleep',
        maxConcurrent: 3,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        onhttpmsg: createHttpTaskDispatchFn(agent, tasksPath),
        tasks: [ 'sleep' ]
    },
    {
        name: 'nop',
        maxConcurrent: 1,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        onhttpmsg: createHttpTaskDispatchFn(agent, tasksPath),
        tasks: [ 'nop' ]
    },
    {
        name: 'test_subtask',
        maxConcurrent: 3,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        onhttpmsg: createHttpTaskDispatchFn(agent, tasksPath),
        tasks: [ 'test_subtask' ]
    },
    {
        name: 'metering',
        maxConcurrent: 3,
        onmsg: createTaskDispatchFn(agent, tasksPath),
        onhttpmsg: createHttpTaskDispatchFn(agent, tasksPath),
        tasks: [ 'meter_query' ]
    }
];

// Don't run provisioner if cn-agent is up and running
var cnAgentConfig;
var cnAgentConfigPath = '/opt/smartdc/agents/etc/cn-agent.config.json';

if (fs.existsSync(cnAgentConfigPath)) {
    try {
        cnAgentConfig = require(cnAgentConfigPath);
        if (cnAgentConfig.no_rabbit) {
            agent.log.warn('"no_rabbit" flag is true for cn-agent, ' +
                'provisioner agent will now sleep');
            // http://nodejs.org/docs/latest/api/all.html#all_settimeout_cb_ms
            // ...The timeout must be in the range of 1-2,147,483,647 inclusive
            setInterval(function () {}, 2000000000);
            return;
        }
    } catch (e) {
        agent.log.warn('Error parsing cn-agent config: "%s". Will now continue ' +
            'running provisioner agent', e.message);
    }
}

// AGENT-640: Ensure we clean up any stale machine creation guard files, then
// set queues up as per usual.
var cmd = '/usr/bin/rm -f /var/tmp/machine-creation-*';
exec(cmd, function (error, stdout, stderr) {
    agent.configureAMQP(function () {
        agent.on('ready', function () {
            agent.setupQueues(queueDefns);
        });
        agent.start();
    });
});
