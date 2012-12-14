var Task = require('task_agent/lib/task');
var VM = require('/usr/vm/node_modules/VM');
var execFile = require('child_process').execFile;
var common = require('../common');

var MachineCreateSnapshotTask = module.exports = function (req) {
    Task.call(this);
    this.req = req;
};

Task.createTask(MachineCreateSnapshotTask);

function start(callback) {
    var self = this;

    VM.logger = common.makeVmadmLogger(self);
    VM.logname = 'machine_create_snapshot';

    var uuid = self.req.params.uuid;
    var snapname = self.req.params.snapshot_name;

    VM.create_snapshot(uuid, snapname, function (error) {
        if (error) {
            var msg = error instanceof Error ? error.message : error;
            self.fatal('VM.create_snapshot error: ' + msg);
            return;
        }
        self.progress(100);
        self.finish();
    });
}

MachineCreateSnapshotTask.setStart(start);
