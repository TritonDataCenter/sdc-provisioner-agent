sys = require('sys');
puts = sys.puts;
inspect = sys.inspect;
path = require('path');

AsyncTest = require('./async-testing/async_testing');
formatSuite = require('./async-testing-junit').convertSuiteToJUnit;

var outputDirectory = "tests/results";
var suiteFiles = [ './tests/test-activate-deactivate-zone'
                 , './tests/test-provision-zone'
                 , './tests/test-provision-timeout'
                 , './tests/test-reboot-zone'
                 , './tests/test-resize-zone'
                 , './tests/test-duplicate-zone-name'
                 , './tests/test-zone-properties'
                 , './tests/test-concurrent-provisioning'
                 ];

var suites = {};

suiteFiles.map(function (path) {
  suites[path] = require(path).suite;
});

AsyncTest.runSuites(suites, function () {
  var name = Object.keys(suites);
  var i = name.length;
  while (i--) {
    (function (i) {
    formatSuite(suites[name[i]], function (rendered) {
      var filename = path.basename(name[i]) + '.xml';
      filename = path.join(outputDirectory, filename);

      puts("writing to " + filename);
      fs.writeFile(filename, rendered);
    });
  })(i);
  }
});
