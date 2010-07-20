exports.LineProducer = LineProducer = function () {
  this.carry = '';
}

LineProducer.prototype.push = function (buffer, callback) {
  var i, il;
  var result, callback;

  // Split the buffer on newlines and if we find the last item isn't an
  // empty string, then that means that we got a data packet that ended in
  // the middle of a line. We'll "carry" that until the next `data` event.
  var lines = (this.carry + buffer.toString()).split("\n");
  this.carry = '';

  // If there was data at the end, we'll carry it. If not, it will clear the
  // carry.
  this.carry = lines.pop();
  
  callback(lines);
}
