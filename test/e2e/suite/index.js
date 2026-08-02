const path = require('node:path');
const Mocha = require('mocha');
const { glob } = require('glob');

function run() {
  const mocha = new Mocha({ ui: 'tdd', color: false, timeout: 60000 });
  const testsRoot = __dirname;

  return new Promise((resolve, reject) => {
    glob('**/*.test.js', { cwd: testsRoot })
      .then((files) => {
        for (const file of files) {
          mocha.addFile(path.resolve(testsRoot, file));
        }
        try {
          mocha.run((failures) => {
            if (failures > 0) {
              reject(new Error(`${failures} test(s) failed.`));
            } else {
              resolve();
            }
          });
        } catch (error) {
          reject(error);
        }
      })
      .catch(reject);
  });
}

module.exports = { run };
