var async = require('async');
var cp = require('child_process');
var dns = require('dns');
var exec = require('child_process').exec;
var os = require('os');
var path = require('path');
var restify = require('restify');
var semver = require('semver');
var tty = require('tty');
var verror = require('verror');
var watershed = require('watershed');
var assert = require('assert-plus');
var http = require('http');


var createTaskDispatchFn
    = require('task_agent/lib/dispatch').createTaskDispatchFn;
var createHttpTaskDispatchFn
    = require('task_agent/lib/dispatch').createHttpTaskDispatchFn;
var sdcconfig = require('./smartdc-config');
var TaskAgent = require('task_agent/lib/task_agent');


function Provisioner(options) {
    assert.object(options, 'options');
    assert.object(options.log, 'options.log');

    this.options = options;
    this.log = options.log;
}


function shuffleArray(array) {
    for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
    return array;
}


Provisioner.prototype.findValidCnapi = function (version, addrs, callback) {
    var self = this;
    addrs = shuffleArray(addrs.slice());

    if (self.lastCnapi) {
        addrs.push.apply(addrs, [self.lastCnapi]);
    }

    self.log.info({ ips: addrs }, 'testing cnapi instances at ips');

    async.map(
        addrs,
        function (ip, mapcb) {
            var u = 'http://' + ip;

            var client = restify.createJsonClient(
                { url: u, connectTimeout: 5000 });

            client.get('/info', function (error, req, res, info) {
                if (error) {
                    self.log.warn(error,
                        'not using cnapi at %s because of error', ip);
                    mapcb(null, null);
                    return;
                }

                self.log.info('version of %s is %s', u, info.version);
                if (semver.gte(info.version, version)) {
                    mapcb(null, ip);
                    return;
                }
                mapcb(null, null);
            });
        },
        function (err, result) {
            result = result.filter(function (i) { return !!i; });
            callback(null, result[0]);
        });
};


Provisioner.prototype.cnapiAddress = function (callback) {
    var self = this;

    sdcconfig.sdcConfig(function (error, config) {
        if (error) {
            callback(new verror.VError(
                error, 'looking up sdc config'));
            return;
        }

        var domainName
            = 'cnapi.' + config.datacenter_name + '.' + config.dns_domain;

        self.log.info({ domainName: domainName }, 'cnapi domain name');

        dns.resolve(domainName, function (dnserror, addrs) {
            if (dnserror) {
                callback(new verror.VError(
                    dnserror, 'resolving cnapi address'));
                return;
            }

            callback(error, addrs);
        });
    });
};

Provisioner.prototype.createPersistentCnapiConnection = function () {
    var self = this;

    var reqCnapiVersion = '1.0.5';

    async.waterfall([
        function (cb) {
            self.cnapiAddress(function (error, addrs) {
                self.findValidCnapi(reqCnapiVersion, addrs,
                    function (finderror, ip) {
                        self.log.info('using cnapi at ip %s', ip);
                        self.lastCnapi = ip;
                        cb();
                    });
            });
        }
    ],
    function (err) {
        createWatershed();
    });


    function createWatershed() {
        var shed = new watershed.Watershed();
        var wskey = shed.generateKey();
        var options = {
            path: '/servers/' + self.uuid + '/attach',
            method: 'GET',
            port: 80,
            hostname: self.lastCnapi,
            headers: {
                'connection': 'upgrade',
                'upgrade': 'websocket',
                'Sec-WebSocket-Key': wskey
            }
        };
        var req = http.request(options);
        req.end();
        req.on('upgrade', function (res, socket, head) {
            self.log.info(
                'websocket connection to cnapi %s opened', self.lastCnapi);

            var wsc = shed.connect(res, socket, head, wskey);

            wsc.send(JSON.stringify({ type: 'register' }));

            wsc.on('end', function () {
                self.log.error(
                    'websocket connection to cnapi %s closed', self.lastCnapi);
            });
        });
    }
};

Provisioner.prototype.start = function () {
    var self = this;




    var agent = new TaskAgent(self.options);
    var tasksPath = self.options.tasksPath;

    var queueDefns = [
        {
            name: 'machine_creation',
            maxConcurrent: os.cpus().length,
            onmsg: createTaskDispatchFn(agent, tasksPath),
            onhttpmsg: createHttpTaskDispatchFn(agent, tasksPath),
            tasks: [ 'machine_create', 'machine_reprovision' ]
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

    async.waterfall([
        function (cb) {
            sdcconfig.sdcConfig(function (error, config) {
                if (error) {
                    cb(new verror.VError(
                        error, 'looking up sdc config'));
                    return;
                }
                self.sdcconfig = config;
                cb();
            });
        },
        function (cb) {
            sdcconfig.sysinfo(function (error, sysinfo) {
                if (error) {
                    cb(new verror.VError(
                        error, 'looking up sysinfo'));
                    return;
                }
                self.sysinfo = sysinfo;
                cb();
            });
        }
    ],
    function (error) {
        self.uuid = self.sysinfo.UUID;

        self.createPersistentCnapiConnection();

        // AGENT-640: Ensure we clean up any stale machine creation guard files,
        // then set queues up as per usual.
        var cmd = '/usr/bin/rm -f /var/tmp/machine-creation-*';
        exec(cmd, function (execerror, stdout, stderr) {
            agent.configureAMQP(function () {
                agent.on('ready', function () {
                    agent.setupQueues(queueDefns);
                });
                agent.start();
            });
        });
    });
};

module.exports = Provisioner;
