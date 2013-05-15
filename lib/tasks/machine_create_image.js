var Task = require('task_agent/lib/task');
var VM = require('/usr/vm/node_modules/VM');
var execFile = require('child_process').execFile;
var common = require('../common');
var imgadm = require('../imgadm');

var MachineCreateImageTask = module.exports = function (req) {
    Task.call(this);
    this.req = req;
};

Task.createTask(MachineCreateImageTask);

function start(callback) {
    var self = this;
    var params = self.req.params;

    params.log = self.log;

    imgadm.createImage(params, function (error) {
        if (error) {
            self.fatal(error.message);
            return;
        }

        self.progress(100);
        self.finish();
    });
}

MachineCreateImageTask.setStart(start);
