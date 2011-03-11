#!/usr/bin/env node

amqp = require('amqp');
execFile = require('child_process').execFile;
sys  = require('sys');
async = require('async');

var creds =
  { host:     process.env['AMQP_HOST']      || 'localhost'
  , port:     process.env['AMQP_PORT']      || 5672
  , login:    process.env['AMQP_LOGIN']     || 'guest'
  , password: process.env['AMQP_PASSWORD']  || 'guest'
  , vhost:    process.env['AMQP_VHOST']     || '/'
  };

var connection = amqp.createConnection(creds);
connection.addListener('ready', function () {
  var exchange = connection.exchange('amq.topic', { type: 'topic' });

  var queuenames = [];

  populateNames(function () {
    deleteQueues(function () {
      connection.end();
    });
  });

  function populateNames (callback) {
    sysinfo(function (error, info) {
      if (error) throw error;
      var queuename;
      queuename = 'provisioner-provisions.'+info['UUID'];
      queuenames.push(queuename);
      queuename = 'provisioner-provisionz.'+info['UUID'];
      queuenames.push(queuename);
      callback();
    });
  }

  function deleteQueues (callback) {
    async.forEach
      ( queuenames
      , function (queuename, callback) {
          console.log("Going to delete queue: " + queuename); 
          var queue = connection.queue(queuename, { autoDelete: false, durable: true });
          queue.addListener("open", function () {
            console.log("Destroying " + queuename);
            queue.destroy();
            callback();
          });
        }
      , function () {
          callback();
        }
      );
  }
});

function execFileParseJSON (bin, args, callback) {
  execFile
    ( bin
    , args
    , function (error, stdout, stderr) {
        if (error)
          return callback(Error(stderr.toString()));
        var obj = JSON.parse(stdout.toString());
        callback(null, obj);
      }
    );
}

function sysinfo(callback) {
  execFileParseJSON
    ( '/usr/bin/sysinfo'
    , []
    , function (error, config) {
        if (error)
          return callback(error);
        callback(null, config);
      }
    );
}
