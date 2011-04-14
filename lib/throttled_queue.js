var ThrottledQueue = module.exports = function(options) {
  var self        = this
    , conn        = options.connection
    , queueName   = options.queueName
    , routingKeys = options.routingKeys
    , queueOptions = options.queueOptions

  this.maxMsgCount = options.maximum;
  this.callback = options.callback;
  this.msgCount = 0;

  var queue
    = this.queue = conn.queue(queueName, queueOptions);

  queue.subscribeJSON({ ack: true }, function (msg) {
    console.log("ThrottledQueue received a message ");
    console.dir(msg);
    self._handleMessage(msg);
  });

  // Bind all the routing keys to our queue
  var i = routingKeys.length;
  while (i--) {
    queue.bind(routingKeys[i]);
  }
}

ThrottledQueue.prototype._handleMessage = function (msg) {
  this.msgCount++;
  this.shifting = false;
  this.callback(null, msg);
}

ThrottledQueue.prototype.next = function () {
  if (this._shouldShift()) {
    this._shift();
  }
}

ThrottledQueue.prototype.complete = function () {
  if (this.msgCount > 0)
    this.msgCount--;
  this.next();
}

ThrottledQueue.prototype._shift = function () {
  console.log("Shifting!");
  this.shifting = true;
  this.queue.shift();
}

/**
 * Stop doing new shift()'s on the queue.
 */

ThrottledQueue.prototype.stop = function () {
  this._stopShifting = true;
}

/**
 * Returns whether we should do a queue.shift() and get a new message. This
 * should only be done if we don't have the maximum number of provisions
 * happening now, if we haven't been told to shutdown and if we're not
 * already shifting.
 */

ThrottledQueue.prototype._shouldShift = function () {
  console.log("Checking if we should shift ("+this.msgCount+"/"+this.maxMsgCount+")");
  if (this.shifting) {
    console.log("Not shifting because we're shifting already.");
    return false;
  }
  else if (this._stopShifting) {
    console.log("Not shifting because we're shutting down.");
    return false;
  }
  else if (!(this.msgCount < this.maxMsgCount)) {
    console.log("Not shifting because we're at the maximum number of concurrent provisions (" + this.msgCount + ").");
    return false;
  }
  else {
    console.log("It's okay to shift.");
    return true;
  }
}

