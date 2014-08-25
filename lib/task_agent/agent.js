/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var EventEmitter   = require('events').EventEmitter;
var util           = require('util');
var amqp           = require('amqp');
var common         = require('./common');
var AgentClient    = require('./client');

function Agent(config) {
    this.config = config || { amqp: {} };
    this.uuid = config.uuid;
}

util.inherits(Agent, EventEmitter);

Agent.prototype.configureAMQP = common.configureAMQP;

Agent.prototype.connect = function (queues, callback) {
    var self = this;

    /**
     * In the case rabbitmq goes offline, back-off retry with random variation.
     * Variation is to prevent all provisioners from simultaenously banging on
     * rabbitmq exactly N seconds after they lost their connections.
     */

    var initialRetryWait = Math.random() * 1000 + 500;
    var delayMs = initialRetryWait;

    self.connection = amqp.createConnection(
        self.config.amqp, { reconnect: false });

    self.connection.on('ready', self.onReady.bind(self));
    self.connection.on('close', onClose);

    function onClose() {
        var msg;

        if (self.connected) {
            msg = 'connection lost';
            delayMs = initialRetryWait;
        } else {
            msg = 'failed to connect';
            delayMs = Math.floor(delayMs * 2);
        }

        self.log.warn('%s, attempting to reconnect in %d seconds',
            msg, delayMs / 1000);
        self.connected = false;
        setTimeout(function () {
            self.connection = amqp.createConnection(
                self.config.amqp, { reconnect: false });
            self.connection.on('ready', self.onReady.bind(self));
            self.connection.on('close', onClose);
        }, delayMs);
    }
};

Agent.prototype.onReady = function () {
    var self = this;
    self.config.log.info('Ready to receive commands');
    self.connected = true;
    self.exchange = self.connection.exchange('amq.topic', { type: 'topic' });

    var nopMsgInterval = setInterval(publishNOP, 30000);

    self.emit('ready');

    function publishNOP() {
        if (!self.connected) {
            clearInterval(nopMsgInterval);
            return;
        }
        self.exchange.publish(self.resource + '._nop.' + self.uuid, {});
    }
};


module.exports = Agent;
