var Task = require('task_agent/lib/task');
var VM = require('/usr/vm/node_modules/VM');
var async = require('async');
var common = require('../common');
var net = require('net');
var util = require('util');



// --- Helpers



/*
 * Converts a dotted IPv4 address to its integer value
 */
function aton(addr) {
    if (!addr || !net.isIPv4(addr)) {
        return null;
    }

    var octets = addr.split('.');
    return Number(octets[0]) * 16777216 +
        Number(octets[1]) * 65536 +
        Number(octets[2]) * 256 +
        Number(octets[3]);
}

/**
 * Add the start_num and end_num integer values to a network based on its
 * subnet
 */
function add_ip_nums(network) {
    var sub = network.subnet.split('/');
    if (sub.length !== 2) {
        return false;
    }
    var start_num = aton(sub[0]);
    if (start_num === null) {
        return false;
    }

    var end_num = start_num + Math.pow(2, 32 - Number(sub[1])) - 1;
    network.start_num = start_num;
    network.end_num = end_num;

    return true;
}

/**
 * Returns true if the nic's parameters indicate that it is on the network.
 */
function network_matches_nic(network, nic, ipNum) {
    if (network.vlan_id == nic.vlan_id && network.start_num <= ipNum &&
        ipNum < network.end_num && nic.netmask == network.netmask) {
        return true;
    }

    return false;
}



// --- Task and its methods



var MachineUpdateNicsTask = module.exports = function (req) {
    Task.call(this);
    this.req = req;
};

Task.createTask(MachineUpdateNicsTask);

function pre_check(callback) {
    var self = this;
    var invalid = [];
    var params = self.req.params;

    if (!params.hasOwnProperty('networks') || !util.isArray(params.networks) ||
        params.networks.length === 0) {
        invalid.push('networks');
    } else {
        for (var n in params.networks) {
            if (!add_ip_nums(params.networks[n])) {
                invalid.push('networks (' + params.networks[n].uuid + ')');
            }
        }
    }

    if (!params.hasOwnProperty('original_network') ||
        typeof (params.original_network) !== 'object' ||
        !params.original_network.hasOwnProperty('subnet')) {
        invalid.push('original_network');

    } else {
        if (!add_ip_nums(params.original_network)) {
            self.log.error('Error adding IP numbers to original network');
            invalid.push('original_network');
        }
    }

    if (invalid.length !== 0) {
        var invalidErr = new Error(util.format(
            'Invalid request parameter%s: %s',
            (invalid.length === 1 ? '' : 's'),
            invalid.join(', ')));
        self.log.error('Error validating parameters');
        self.log.error(invalidErr, 'Error validating parameters');
        callback(invalidErr);
        return;
    }

    callback();
}

function filter_vms(callback) {
    var self = this;
    var params = self.req.params;
    var orig = params.original_network;
    var lookup = {
        'nics.*.nic_tag': orig.nic_tag,
        'nics.*.netmask': orig.netmask,
        'nics.*.vlan_id': orig.vlan_id
    };
    var opts = {
        fields: [ 'uuid', 'nics', 'internal_metadata' ]
    };
    var updates = [];

    VM.lookup(lookup, opts, function (err, results) {
        if (err) {
            err.message = 'Error looking up VMs: ' + err.message;
            callback(err);
            return;
        }

        // Further filter: make sure one of the VM's IPs is in the
        // original network (VM.lookup does not currently support this)
        results.forEach(function (vm) {
            var matched = false;
            var resolvers = [];

            if (vm.hasOwnProperty('internal_metadata') &&
                vm.internal_metadata.hasOwnProperty('set_resolvers') &&
                !vm.internal_metadata.set_resolvers) {
                self.log.info('VM "' + vm.uuid
                    + '" has set_resolvers=false: not updating');
                return;
            }

            vm.nics.forEach(function (nic) {
                var ipNum = aton(nic.ip);
                if (!ipNum) {
                    self.log.warning(
                        util.format('VM %s: invalid or DHCP IP for nic',
                        vm.uuid));
                    self.log.warning(nic);
                    return;
                }

                if (network_matches_nic(orig, nic, ipNum)) {
                    // XXX: this double log (and others) is because the
                    // provisioner logger won't log the message if there's
                    // also an object as the first argument.
                    self.log.info(util.format('VM %s: matched nic %s',
                            vm.uuid, nic.mac));
                    self.log.info({ nic: nic });
                    matched = true;
                }

                params.networks.forEach(function (network) {
                    if (network_matches_nic(network, nic, ipNum) &&
                        network.hasOwnProperty('resolvers') &&
                        network.resolvers.length !== 0) {

                        network.resolvers.forEach(function (r) {
                            if (resolvers.indexOf(r) === -1) {
                                resolvers.push(r);
                            }
                        });
                    }
                });
            });

            if (matched) {
                updates.push({
                    uuid: vm.uuid,
                    params: {
                        resolvers: resolvers
                    }
                });
            }
        });

        self.log.info(util.format('%d VMs to update', updates.length));
        self.log.info({ updates: updates }, '%d VMs to update',
            updates.length);
        self.updates = updates;

        callback();
    });
}

function perform_updates(callback) {
    var self = this;
    if (!self.updates || self.updates.length === 0) {
        self.log.info('No updates to perform');
        callback();
        return;
    }

    async.forEachSeries(self.updates, function (update, cb) {
        self.log.info('Updating VM "' + update.uuid + '"');
        self.log.info(update.params);

        VM.update(update.uuid, update.params, function (err) {
            if (err) {
                self.log.error('Error updating VM "' + update.uuid + '"');
                err.message = 'Error updating VM "' + update.uuid + '": ' +
                    err.message;
                cb(err);
                return;
            }

            self.log.info('Updated VM "' + update.uuid + '"');
            cb();
        });
    }, function (err) {
        if (err) {
            callback(err);
            return;
        }

        self.progress(100);
        callback();
    });
}

function start(callback) {
    var self = this;

    VM.logger = common.makeVmadmLogger(self);
    VM.logname = 'machine_nics_update';

    async.waterfall([
        self.pre_check.bind(self),
        self.filter_vms.bind(self),
        self.perform_updates.bind(self)
    ], function (err) {
        if (err) {
            self.fatal(err.message);
            return;
        }
        self.finish();
    });
}

MachineUpdateNicsTask.setStart(start);

MachineUpdateNicsTask.createSteps({
    pre_check: {
        fn: pre_check,
        progress: 20,
        description: 'Pre-flight sanity check'
    },
    filter_vms: {
        fn: filter_vms,
        progress: 50,
        description: 'Filtering VMs'
    },
    perform_updates: {
        fn: perform_updates,
        progress: 100,
        description: 'Updating VMs'
    }
});
