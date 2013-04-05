
var Task = require('task_agent/lib/task');
var VM = require('/usr/vm/node_modules/VM');
var execFile = require('child_process').execFile;
var common = require('../common');
var fs = require('fs');
var async = require('async');
var sysinfo = require('../smartdc-config').sysinfo;
var libcommon = require('../common');

function ServerOverprovisionRatioTask(req) {
    Task.call(this);
    this.req = req;
}

Task.createTask(ServerOverprovisionRatioTask);

function start(callback) {
    var self = this;

    var value = self.req.params.value;

    if (!value) {
        self.fatal('no value given');
        return;
    }
    var configPath;

    var sysinfoValues;
    async.waterfall([
        function (cb) {
            sysinfo(function (error, s) {
                sysinfoValues = s;
                cb();
            });
        },
        function (cb) {
            if (sysinfoValues['Boot Parameters'].headnode === 'true') {
                configPath = '/usbkey/config';
            } else {
                configPath = '/opt/smartdc/config/node.config';
            }

            libcommon.modifyConfig(
                configPath, 'overprovision_ratio', value, cb);
        }
    ],
    function (error) {
        if (error) {
            self.log.error(error);
            self.fatal({ error: error.message });
            return;
        }
        self.finish();
    });
}

ServerOverprovisionRatioTask.setStart(start);

module.exports = ServerOverprovisionRatioTask;
