var Task = require('task_agent/lib/task');
var fw = require('/usr/fw/lib/fw');
var VM = require('/usr/vm/node_modules/VM');
var common = require('../common');

var FwUpdateTask = module.exports = function (req) {
    Task.call(this);
    this.req = req;
};

Task.createTask(FwUpdateTask);

function start(callback) {
    var self = this;

    VM.logger = common.makeVmadmLogger(self);
    VM.logname = 'fw_update';

    return VM.lookup({}, { 'full': true }, function (err, vms) {
        if (err) {
            var msg = err instanceof Error ? err.message : err;
            return self.fatal('VM.lookup error: ' + msg);
        }

        self.progress(50);
        var opts = self.req.params;
        opts.vms = vms;
        opts.logName = 'provisioner';

        return fw.update(opts, function (err2, res) {
            if (err2) {
                return self.fatal('fw.update error: ' + err2.message);
            }

            self.progress(100);
            return self.finish();
        });
    });
}

FwUpdateTask.setStart(start);
