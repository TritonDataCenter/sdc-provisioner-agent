sys = require('sys');

puts = sys.puts;
inspect = sys.inspect;
ejs = require('./lib/ejs');

function escape(str) {
  return str.replace(/&/gmi, '&amp;')
            .replace(/"/gmi, '&quot;')
            .replace(/>/gmi, '&gt;')
            .replace(/</gmi, '&lt;');
}

exports.convertSuiteToJUnit = function convertSuiteToJUnit(suite, callback) {
  var suiteResult = {};
  suiteResult.name = suite.name;
  suiteResult.failureCount = suite.numFailedTests;
  suiteResult.errorCount = suite.numFailedTests;
  suiteResult.tests = suite.numFinishedTests;
  suiteResult.elapsed = 420;

  suiteResult.testcases = suite.tests.map(function (test) {
    var testcase = {};

    testcase.name = test.__name;
    testcase.phase = test.__phase;
    testcase.elapsed = 666;

    switch (test.__symbol) {
      case 'E':
        if (test.__failure instanceof Error) {
          testcase.failure = { message: escape(test.__failure.message)
                             , backtrace: escape(test.__failure.stack)
                             , type: 'Error'
                             };
        }
        else {
          testcase.failure = { message: escape(test.__failure.message)
                             , type: 'Error'
                             };
        }
        break;

      case 'F':
        testcase.failure = { message: escape(test.__failure.message)
                           , backtrace: escape(test.__failure.stack)
                           , type: test.__failure.name
                           };
        break;
      default:
        testcase.failure = false;
    }

    return testcase;
  });

  fs.readFile("tests/junit.xml.ejs", function (error, data) {
    if (error) throw error;
    var rendered = ejs.render(data.toString(),
                    { locals: { suites: [ suiteResult ] } });
    callback(rendered);
  });
}
