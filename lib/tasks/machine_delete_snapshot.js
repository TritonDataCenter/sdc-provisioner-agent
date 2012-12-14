var Task = require('task_agent/lib/task');
var VM = require('/usr/vm/node_modules/VM');
var execFile = require('child_process').execFile;
var common = require('../common');

var MachineDeleteSnapshotTask = module.exports = function (req) {
    Task.call(this);
    this.req = req;
};

Task.createTask(MachineDeleteSnapshotTask);

function start(callback) {
    var self = this;

    VM.logger = common.makeVmadmLogger(self);
    VM.logname = 'machine_delete_snapshot';

    var uuid = self.req.params.uuid;
    var snapname = self.req.params.snapshot_name;

    VM.delete_snapshot(uuid, snapname, function (error) {
        if (error) {
            var msg = error instanceof Error ? error.message : error;
            self.fatal('VM.delete_snapshot error: ' + msg);
            return;
        }
        self.progress(100);
        self.finish();
    });
}

MachineDeleteSnapshotTask.setStart(start);
