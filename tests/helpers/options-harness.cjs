const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run options handlers against observable browser API boundaries.
function loadOptions(response = { success: true, importedCount: 1, validCount: 1 }, { saveError = false } = {}) {
    const requests = [];
    const writes = [];
    const chrome = {
        storage: {
            local: {
                get: () => assert.fail('History mutations must go through the background worker'),
                set: () => assert.fail('History mutations must go through the background worker')
            },
            sync: {
                set(value, callback) {
                    writes.push(value);
                    if (saveError) chrome.runtime.lastError = { message: 'write failed' };
                    callback();
                    delete chrome.runtime.lastError;
                }
            }
        },
        runtime: { sendMessage: (request, callback) => { requests.push(request); callback(response); } },
        i18n: { getMessage: key => key }
    };
    const context = vm.createContext({
        document: { addEventListener() {} }, chrome, confirm: () => true,
        FileReader: class {
            // Deliver file content to the actual import callback.
            readAsText(file) { this.onload({ target: { result: file.content } }); }
        }
    });
    const shared = path.join(__dirname, '../../shared/config.js');
    vm.runInContext(fs.readFileSync(shared, 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../options/options.js'), 'utf8'), context);
    vm.runInContext(`
        globalThis.statsReloads = 0;
        globalThis.statuses = [];
        loadStats = () => { statsReloads++; };
        showStatus = (type, message) => { statuses.push({ type, message }); };
    `, context);
    return { context, requests, writes };
}

module.exports = { loadOptions };
