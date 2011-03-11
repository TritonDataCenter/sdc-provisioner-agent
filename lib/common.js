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

var FIELDS = 'zoneid:zonename:state:zonepath:uuid:brand:ip-type'.split(':');;

exports.parseZoneList = function (data) {
  var zones = {};
  var lines = data.trim().split("\n");
  var i = lines.length;
  var j;
  var zone;
  var fieldsLength = FIELDS.length;

  while (i--) {
    var lineParts = lines[i].split(':');
    var zoneName = lineParts[1];
    j = fieldsLength;
    zones[zoneName] = zone = {};

    while (j--) {
      zone[FIELDS[j]] = lineParts[j];
    }
  }

  return zones;
}

exports.zoneList = function zoneList(name, callback) {
  var args = [ 'list', '-pc' ];

  if (name) args.push(name);

  execFile
    ( '/usr/sbin/zoneadm'
    , args
    , function (error, stdout, stderr) {
        if (error) return callback(error);
        callback(null, exports.parseZoneList(stdout));
      }
    );
}
