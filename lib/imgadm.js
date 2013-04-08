/**
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * A light wrapper around the `imgadm` tool. Currently this just shell's
 * out to `imgadm` rather than using a node.js API.
 */

var execFile = require('child_process').execFile;
var assert = require('assert');
var format = require('util').format;



// ---- globals

var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;



// ---- main functionality

/**
 * Import the given image.
 *
 * It is up to the caller to ensure this UUID is not already installed.
 *
 * @param {Object} options:
 *      - @param {UUID} uuid - The UUID of the remote image to import.
 *      - @param {String} zpool - The zpool to which to import.
 *      - @param {Object} log - A log object on which to call log.info
 *        for successful run output.
 * @param callback {Function} `function (err)`
 */
function importImage(options, callback) {
    assert.ok(options, 'options');
    assert.ok(options.uuid && UUID_RE.test(options.uuid), 'options.uuid');
    assert.ok(options.zpool && typeof (options.zpool) === 'string',
        'options.zpool');
    assert.ok(options.log, 'options.log');

    var argv = ['/usr/sbin/imgadm', 'import', '-q', '-P',
                options.zpool, options.uuid];
    options.log.info('calling: ' + argv.join(' '));
    execFile(argv[0], argv.slice(1), { encoding: 'utf8' },
        function (err, stderr, stdout) {
            if (err) {
                callback(new Error(format(
                    'Error importing image %s to zpool %s:\n'
                    + '\targv: %j\n'
                    + '\texit status: %s\n'
                    + '\terr: %s\n'
                    + '\tstdout: %s\n'
                    + '\tstderr: %s', options.uuid, options.zpool,
                    argv, err.code, String(err).trim(), stdout.trim(),
                    stderr.trim())));
                return;
            }
            options.log.info(format('imported image %s: stdout=%s stderr=%s',
                options.uuid, stdout.trim(), stderr.trim()));
            callback();
        });
}



// ---- exports

module.exports = {
    importImage: importImage
};
