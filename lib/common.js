/**
 * Common functions that don't belong anywhese else.
 */

var fs = require('fs');


/**
 * Returns a copy of an object withs keys upper-cased.
 *
 * @param obj {Object} 
 *   Covert the keys of `obj` to uppercase and return new object.
 */

exports.keysToUpper = function (obj) {
  var upperObj = {};
  var keys = Object.keys(obj);
  var i = keys.length;
  while (i--) {
    upperObj[keys[i].toUpperCase()] = obj[keys[i]];
  }
  return upperObj;
}


/**
 * Overlay the properties of one object over another.
 */

exports.extend = function (base, overlay) {
  var obj = new Object(base);
  var props = Object.getOwnPropertyNames(overlay);
  var dest = this;
  props.forEach(function(name) {
    obj[name] = overlay[name];
  });
  return obj;
}
