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
    VM.logname = 'machine_update';

    VM.update(uuid, self.req.params, function (error) {
        if (error) {
            var msg = error instanceof Error ? error.message : error;
            self.fatal('VM.update error: ' + msg);
            return;
        }

        if (!self.req.params.hasOwnProperty('add_nics') &&
            !self.req.params.hasOwnProperty('remove_nics')) {
            self.progress(100);
            self.finish();
            return;
        }

        self.progress(50);

        VM.load(uuid, function (error2, vm) {
            if (error2) {
                self.fatal('VM.reboot error: ' + error2.message);
                return;
            }

            if (vm.state !== 'running') {
                self.progress(100);
                self.finish();
                return;
            }

            self.progress(75);
            VM.reboot(uuid, {}, function (error3) {
                if (error3) {
                    self.fatal('VM.reboot error: ' + error3.message);
                    return;
                }

                self.progress(100);
                self.finish();
            });
        });
    });
}

MachineUpdateTask.setStart(start);
