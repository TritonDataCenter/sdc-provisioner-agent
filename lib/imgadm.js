/**
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * A light wrapper around the `imgadm` tool. Currently this just shell's
 * out to `imgadm` rather than using a node.js API.
 */

var execFile = require('child_process').execFile;
var assert = require('assert');
var format = require('util').format;
var crypto = require('crypto');
var fs = require('fs');
var zfs = require('zfs').zfs;


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

    // Hack to workaround OS-2203 (imgadm import not supporting concurrent
    // imports).
    // 1hr timeout -- same as the CNAPI task in the provision workflow
    options.timeout = 1000 * 60 * 60;
    waitForConcurrentImageImport(options, function (waitErr) {
        if (waitErr) {
            callback(waitErr);
            return;
        }
        var argv = ['/usr/sbin/imgadm', 'import', '-q', '-P',
                    options.zpool, options.uuid];
        options.log.info('calling: ' + argv.join(' '));
        execFile(argv[0], argv.slice(1), { encoding: 'utf8' },
            function (err, stdout, stderr) {
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
                options.log.info(format(
                    'imported image %s: stdout=%s stderr=%s',
                    options.uuid, stdout.trim(), stderr.trim()));
                callback();
            });
    });
}


function waitForConcurrentImageImport(options, callback) {
    assert.ok(options, 'options');
    assert.ok(options.uuid && UUID_RE.test(options.uuid), 'options.uuid');
    assert.ok(options.zpool && typeof (options.zpool) === 'string',
        'options.zpool');
    assert.ok(options.timeout, 'options.timeout');
    assert.ok(options.log, 'options.log');

    var end = Date.now() + options.timeout;
    var INTERVAL = 10 * 1000; // 10s
    // Per -partial name in imgadm:
    // JSSTYLED
    // <https://github.com/joyent/smartos-live/blob/master/src/img/lib/imgadm.js#L1571-L1576>
    var partialDsName = format('%s/%s-partial', options.zpool, options.uuid);

    setTimeout(pollOnce, Math.random() * 1000);

    function pollOnce() {
        zfs.list(partialDsName, function (err, ds) {
            if (ds) {
                var now = Date.now();
                if (now >= end) {
                    callback(new Error(format('timeout waiting for partial'
                        + ' dataset "%s" to be removed', partialDsName)));
                } else {
                    options.log.info('"%s" dataset exists, waiting',
                        partialDsName);
                    setTimeout(pollOnce, INTERVAL);
                }
            } else if (err && err.message &&
                err.message.indexOf('dataset does not exist'))
            {
                // Expected error is:
                // JSSTYLED
                //      Command failed: cannot open 'zones/fac31b04-af9e-4c55-8f9d-74b0eead711f': dataset does not exist
                callback();
            } else {
                callback(new Error(format('unexpected error listing partial'
                    + ' dataset "%s"', partialDsName)));
            }
        });
    }
}

/**
 * Create an image from a given VM.
 *
 */

function createImage(options, callback) {
    assert.ok(options, 'options');
    assert.ok(options.compression, 'options.compression');
    assert.ok(options.imgapi_url, 'options.imgapi_url');
    assert.ok(options.manifest, 'options.manifest');
    assert.ok(options.uuid, 'options.uuid');
    assert.ok(options.manifest.uuid, 'options.manifest.uuid');

    var filename = '/var/tmp/.provisioner-create-image-'
        + crypto.randomBytes(4).readUInt32LE(0) + '.json';

    fs.writeFileSync(filename, JSON.stringify(options.manifest));

    var argv = [
        '/usr/sbin/imgadm',
        '-vvv',
        'create', '-m', filename,
        '-c', options.compression,
        options.uuid,
        '--publish', options.imgapi_url]
        .concat(options.incremental ? ['--incremental'] : []);

    options.log.info('calling: ' + argv.join(' '));

    execFile(argv[0], argv.slice(1), { encoding: 'utf8' },
        function (err, stdout, stderr) {
            fs.unlinkSync(filename);
            if (err) {
                callback(new Error(format(
                    'Error creating and publishing image %s from VM %s:\n'
                    + '\targv: %j\n'
                    + '\texit status: %s\n'
                    + '\terr: %s\n'
                    + '\tstdout: %s\n'
                    + '\tstderr: %s',
                    options.manifest.uuid,
                    options.uuid,
                    argv, err.code, String(err).trim(), stdout.trim(),
                    stderr.trim())));
                return;
            }
            options.log.info(format('created and published image %s from '
                + 'VM %s:\n'
                + '\targv: %j\n'
                + '\tstdout: %s\n'
                + '\tstderr: %s\n',
                options.manifest.uuid,
                options.uuid,
                argv,
                stdout.trim(),
                stderr.trim()));
            callback();
        });
}


// ---- exports

module.exports = {
    importImage: importImage,
    createImage: createImage
};
