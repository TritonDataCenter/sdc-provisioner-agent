var Task = require('task_agent/lib/task');
var VM  = require('/usr/vm/node_modules/VM');
var async = require('async');
var common = require('../common');
var fs = require('fs');
var imgadm = require('../imgadm');
var path = require('path');
var spawn = require('child_process').spawn;
var util = require('util');
var zfs = require('zfs').zfs;

var MachineCreateTask = module.exports = function (req) {
    Task.call(this);
    this.req = req;
    this.zpool = req.params.zfs_storage_pool_name || 'zones';
};

Task.createTask(MachineCreateTask);

function start(callback) {
    var self = this;

    VM.logger = common.makeVmadmLogger(self);
    VM.logname = 'machine_create';
    var creationGuardFilename;

    self.pre_check(function (error) {
        if (error) {
            self.fatal(error.message);
            return;
        }

        async.waterfall([
            function (cb) {
                common.provisionInProgressFile(
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
    var self = this;

    var fullDataset;
    var params = self.req.params;


    // TODO Enable provisioner to be able to check a list of image_uuids and
    // fetch any that are not installed
    self.toImport = null;

    if (params.image_uuid) {
        self.toImport = params.image_uuid;
    } else if (self.req.params.disks && self.req.params.disks.length) {
        self.toImport = self.req.params.disks[0].image_uuid;
    }

    fullDataset = this.zpool + '/' + self.toImport;

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

    var options = {
        uuid: self.toImport,
        zpool: self.zpool,
        log: self.log
    };
    imgadm.importImage(options, function (err) {
        if (err) {
            self.log.error(err);
            callback(err);
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
