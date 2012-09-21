var Task = require('task_agent/lib/task');
var VM = require('/usr/vm/node_modules/VM');
var execFile = require('child_process').execFile;
var common = require('../common');

var MachineUpdateTask = module.exports = function (req) {
    Task.call(this);
    this.req = req;
};

Task.createTask(MachineUpdateTask);

function start(callback) {
    var self = this;
    var uuid = self.req.params.uuid;

    VM.logger = common.makeVmadmLogger(self);

    VM.update(uuid, self.req.params, function (error) {
        if (error) {
            var msg = error instanceof Error ? error.message : error;
            self.fatal('VM.update error: ' + msg);
            return;
        }
        self.progress(100);
        self.finish();
    });
}

MachineUpdateTask.setStart(start);
