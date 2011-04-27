var net = require('net');
var events = require('events');
var util = require('util');
var sys = require('sys');

function encode(data) {
  return JSON.stringify(data);
};

function Client() {
  events.EventEmitter.call(this);
};

util.inherits(Client, events.EventEmitter);

/**
 * connect
 *
 * @param {String} socket (example: /tmp/vmadmd.sock)
 * @param {Function} callback callback to execute on a successful connection
 *
 * @return {Client} client
 */
Client.prototype.connect = function(sock, callback) {
  var self = this;

  this.connection = net.Stream();
  this.connection.setEncoding("utf8");

  this.connection.on("data", function(result) {
    var data = JSON.parse(result)
    self.emit("data", data);

    if (data.id) {
      self.emit("data-"+id, data)
    }
  });

  this.connection.on('connect', function(socket) {
    self.emit('connect', callback);
  })

  this.connection.connect(sock);

  return this;
};

/**
 * Sends an action to vmadmd with the provided payload
 *
 * @param {String} action Action to call (ie: shutdown/halt/create)
 * @param {Object} payload Payload to send with the action, optional
 * @param {Function} callback executes callback(result) on response
 */
Client.prototype.action = function(action, payload, callback) {
  if (arguments.length === 2 && typeof payload === 'Function') {
    callback = payload;
    payload  = null;
  }

  var id = (new Date).getTime();

  var data = { 'id': id
             , 'action': action
             , 'payload': payload };

  if (callback !== undefined) {
    this.once("data-"+id, callback);
  }

  this.connection.write(encode(data) + "\n\n");
}

exports.Client = Client;
