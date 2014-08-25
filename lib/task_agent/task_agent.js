/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var util = require('util');
var path = require('path');
var Agent = require('./agent');
var ThrottledQueue = require('./throttled_queue');
var common = require('./common');
var TaskRunner = require('./task_runner');
var bunyan = require('bunyan');
var os = require('os');
var async = require('async');

function TaskAgent(config) {
    if (!config.resource) {
        throw new Error(
            'configuration parameter "resource" must be specified');
    }

    this.tasklogdir = config.tasklogdir;
    this.log = bunyan.createLogger({ name: config.logname });
    config.log = this.log;
    Agent.call(this, config);

    if (config.tasksPath) {
        this.tasksPath = config.tasksPath;
    } else {
        this.log.warn(
            'Warning: no taskPaths specified when instantiating TaskAgent');
        this.tasksPath = path.join(__dirname, '..', 'tasks');
    }
    this.resource = config.resource;
    this.runner = new TaskRunner({
        log: this.log,
        logdir: this.tasklogdir,
        tasksPath: this.tasksPath
    });
}

util.inherits(TaskAgent, Agent);

TaskAgent.prototype.start = function () {
    this.connect();
};

TaskAgent.prototype.useQueues = function (defns) {
    var self = this;

    self.queueDefns = defns;

    defns.forEach(function (queueDefn) {
        var routingKeys
            = queueDefn.tasks.map(function (t) {
                return [
                    self.resource,
                    self.uuid,
                    'task',
                    t
                ].join('.');
            });

        var queueName = [self.resource, self.uuid, queueDefn.name].join('.');
        var queue;
        var logging;

        if (typeof (queueDefn.logging) !== 'undefined') {
            logging = !!queueDefn.logging;
        } else {
            logging = true;
        }

        function callback(msg, headers, deliveryInfo) {
            var rkParts = deliveryInfo.routingKey.split('.');
            var task = rkParts[3];
            var clientId = msg.client_id;
            var taskId = msg.task_id;

            var logopts = { task_id: msg.task_id };

            if (typeof (msg.req_id) !== 'undefined') {
                logopts.req_id = msg.req_id;
            }

            self.log.info({
                msg: msg,
                req_id: msg.req_id,
                logging: logging,
                routing_key: deliveryInfo.routingKey
            }, 'Incoming message');

            var request = {
                logging:   logging,
                finish:    finish,
                task:      task,
                req_id:    msg.req_id,
                params:    msg,
                event:     event,
                progress:  progress
            };

            queueDefn.onmsg(request);

            function finish() {
                queue.complete();
            }

            function progress(value) {
                event('progress', { value: value });
            }

            function event(name, message) {
                var rk = common.dotjoin(
                            self.resource,
                            self.uuid,
                            'event',
                            name,
                            clientId,
                            taskId);

                self.log.info({
                    message: message,
                    req_id: msg.req_id
                }, 'Publishing event to routing key (%s)', rk);
                self.exchange.publish(rk, message);
            }
        }

        self.log.info({
            routing_keys: routingKeys
        }, 'Binding routing keys to queue (%s)', queueName);

        var queueOptions = { 'arguments': {} };
        if (queueDefn.expires) {
            queueOptions.arguments['x-message-ttl'] =
                queueDefn.expires * 1000;
        }

        var options = {
            connection:   self.connection,
            queueName:    queueName,
            routingKeys:  routingKeys,
            callback:     callback,
            maximum:      queueDefn.maxConcurrent,
            log:          self.log,
            queueOptions: queueOptions
        };
        queue = new ThrottledQueue(options);
        queue.next();
    });
};

TaskAgent.prototype.setupPingQueue = function (taskQueues) {
    var self = this;
    var queueName = this.resource + '.ping.' + this.uuid;
    var queue = this.connection.queue(queueName);

    queue.addListener('open', function (messageCount, consumerCount) {
        queue.bind(
            'amq.topic', self.resource + '.ping.' + self.uuid);
        queue.subscribe({ ack: true }, function (msg, headers, deliveryInfo) {
            self.log.info('Received ping message');
            var client_id = msg.client_id;
            var id = msg.id;

            msg = {
                req_id: id,
                timestamp: new Date().toISOString()
            };
            var routingKey = self.resource + '.ack'
                                + client_id + '.' + self.uuid;

            self.log.info('Publishing ping reply to ' + routingKey);
            self.exchange.publish(routingKey, msg);

            queue.shift();
        });
    });
};

TaskAgent.prototype.setupQueues = function (taskQueues) {
    var self = this;

    self.log.warn('setting up queues');

    self.setupPingQueue();

    var taskManagementQueues = [
        {
            name: 'task_management',
            maxConcurrent: 8,
            tasks: [ 'show_tasks' ],
            onmsg: function (req) {
                var history = self.runner.taskHistory;
                var i;

                for (i = history.length; i--; ) {
                    var entry = history[i];
                    var started_at = new Date(entry.started_at);
                    var finished_at = entry.finished_at
                        ? new Date(entry.finished_at)
                        : new Date();
                    entry.elapsed_seconds = (finished_at - started_at) / 1000;
                }

                req.event('finish', { history: history });
                req.finish();
            }
        }
    ];

    self.useQueues(taskManagementQueues);
    self.useQueues(taskQueues);
};

module.exports = TaskAgent;
