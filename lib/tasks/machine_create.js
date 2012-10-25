var Task = require('task_agent/lib/task');
var VM  = require('/usr/vm/node_modules/VM');
var async = require('async');
var common = require('../common');
var fs = require('fs');
var imgadm = require('/usr/img/node_modules/imgadm');
var path = require('path');
var spawn = require('child_process').spawn;
var system = require('/usr/node/node_modules/system');
var util = require('util');
var zfs = require('zfs').zfs;

var MachineCreateTask = module.exports = function (req) {
    Task.call(this);
    req.params.zpool_path = path.join('/', this.zpool);
    this.req = req;
    this.zpool = req.params.zfs_storage_pool_name || 'zones';
};

Task.createTask(MachineCreateTask);

function start(callback) {
    var self = this;

    VM.logger = common.makeVmadmLogger(self);
    VM.logname = 'machine_create';
    imgadm.log.config.format = 'application/json';
    imgadm.log.setWriter(function (message) {
        var level
            = (message.level === 'err' ? 'error' : message.level)
                .toLowerCase();

        self.log[level](message.message);
    });
    var creationGuardFilename;

    self.req.params.image_uuid
        = self.req.params.image_uuid || self.req.params.dataset_uuid;

    self.pre_check(function (error) {
        if (error) {
            self.fatal(error.message);
            return;
        }

        async.waterfall([
            function (cb) {
                common.createMachineInProgressFile(
                    self.req.params.uuid,
                    function (err, filename) {
                        creationGuardFilename = filename;
                        cb();
                        return;
                    });
            },
            self.ensure_dataset_present.bind(self),
            function (found, cb) {
                // The previous step (ensure..) returns a boolean indicating
                // whether the dataset was found. If that flag is set, we'll
                // run this (fetch) step and skip it if not.
                if (!found) {
                    return self.fetch_dataset(cb);
                } else {
                    return cb();
                }
            },
            self.create_machine.bind(self)
        ],
        function (err) {
            fs.unlink(creationGuardFilename, function () {
                if (err) {
                    self.fatal(err.message);
                    return;
                }
                self.finish();
            });
        });
    });
}

function pre_check(callback) {
    var dataset;
    var self = this;
    var zoneDataset = path.join(self.zpool, self.req.params.uuid);

    dataset = self.req.params.image_uuid;

    var zoneSnapshot
    = path.join(self.zpool, dataset) + '@' + self.req.params.uuid;

    async.waterfall([
        function (cb) {
            // Ensure we have enough memory if machine is a VM
            if (self.req.params.brand !== 'kvm') {
                cb();
                return;
            }

            system.getProvisionableMemory(
                function (error, provisionableMemory) {
                    if (error) {
                        self.fatal(
                            'Error getting system provisionable memory: '
                            + error.message);
                        return;
                    }

                    self.log.info('Requesting vm with ' + self.req.params.ram
                        + ' MiB of ram, compute node has '
                        + provisionableMemory
                        + ' MiB available for provisioning.');

                    if (self.req.params.ram > provisionableMemory) {
                        self.fatal(
                        'Requested machine ram exceeds provisionable memory');
                        return;
                    }
                    cb();
            });
        },
        function (cb) {
            // fail if zone with uuid exists
            common.zoneList(self.req.params.uuid, function (error, zones) {
                if (zones[self.req.params.uuid]) {
                    cb(new Error(
                        'Machine ' + self.req.params.uuid + ' exists.'));
                    return;
                }
                cb();
            });
        },
        function (cb) {
            // If we don't get an error on this `list` it means the dataset
            // exists.
            zfs.list(
            zoneDataset, { type: 'all' }, function (error, fields, list) {
                if (list && list.length) {
                    cb(new Error('Dataset ' + zoneDataset + ' exists.'));
                    return;
                }
                cb();
            });
        },
        function (cb) {
            // If we don't get an error on this `list` it means the snapshot for
            // the zone template exists.
            zfs.list(zoneSnapshot, { type: 'all' },  function (error) {
                if (!error) {
                    cb(new Error('Snapshot ' + zoneSnapshot + ' exists.'));
                    return;
                }
                cb();
            });
        }
    ],
    function (error) {
        if (error) {
            callback(error);
            return;
        }
        callback();
    });
}

function ensure_dataset_present(callback) {
    var dataset;
    var fullDataset;
    var self = this;
    var params = self.req.params;

    dataset = params.image_uuid;
    if (!dataset) {
        callback(new Error('payload is missing image_uuid'));
        return;
    }
    fullDataset = this.zpool + '/' + dataset;

    self.log.info(
        'Checking whether zone template dataset '
        + fullDataset + ' exists on the system.');

    zfs.list(
        fullDataset,
        { type: 'all' },
        function (error, fields, list) {
            if (!error && list.length) {
                self.log.info('Dataset ' + fullDataset + ' exists.');
                callback(null, true);
                return;
            } else if (error && error.toString().match(/does not exist/)) {
                self.log.info('Dataset template didn\'t appear to exist.');
                callback(null, false);
                return;
            }
        });
}

function fetch_dataset(callback) {
    var self = this;
    var params = self.req.params;
    var imageUuid = params.image_uuid;

    imgadm.importRemote(imageUuid, function (error) {
        if (error) {
            self.log.error(error);
            callback(normalizeError(error));
            return;
        }
        callback();
    });
}

function normalizeError(error) {
    if (error instanceof String || typeof (error === 'string')) {
        return new Error(error);
    }
    return error;
}

function create_machine(callback) {
    var self = this;
    var req = self.req;

    VM.create(req.params, function (error, info) {
        if (error) {
            var msg = error instanceof Error ? error.message : error;
            return callback(new Error('VM.create error: ' + msg));
        }
        return callback();
    });
}

MachineCreateTask.setStart(start);

MachineCreateTask.createSteps({
    pre_check: {
        fn: pre_check,
        progress: 20,
        description: 'Pre-flight sanity check'
    },
    ensure_dataset_present: {
        fn: ensure_dataset_present,
        progress: 30,
        description: 'Checking for zone template dataset'
    },
    fetch_dataset: {
        fn: fetch_dataset,
        progress: 50,
        description: 'Fetching zone template dataset'
    },
    create_machine: {
        fn: create_machine,
        progress: 100,
        description: 'Creating machine'
    }
});
