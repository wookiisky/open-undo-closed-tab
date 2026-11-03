const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');

const { loadOptions } = require('./helpers/options-harness.cjs');

test('settings trimming is delegated to the background queue', () => {
    const { context, requests } = loadOptions();
    vm.runInContext('trimHistory()', context);
    assert.equal(requests[0].action, 'trimClosedTabs');
    assert.equal(context.statsReloads, 1);
});

test('import parsing delegates merge and save to the background queue', () => {
    const { context, requests } = loadOptions();
    context.importEvent = { target: { value: 'history.json', files: [{ content: JSON.stringify([
        { id: 'one', title: 'Page', url: 'https://example.com/', closedAt: 100 }
    ]) }] } };
    vm.runInContext('importData(importEvent)', context);
    assert.equal(requests[0].action, 'importClosedTabs');
    assert.equal(requests[0].tabs.length, 1);
    assert.equal(context.importEvent.target.value, '');
    assert.equal(context.statsReloads, 1);
    assert.equal(context.statuses[0].type, 'success');
});

test('failed background import reports failure instead of success', () => {
    const { context, requests } = loadOptions({ success: false });
    context.importEvent = { target: { files: [{ content: JSON.stringify([
        { id: 'one', title: 'Page', url: 'https://example.com/', closedAt: 100 }
    ]) }] } };
    vm.runInContext('importData(importEvent)', context);
    assert.equal(requests[0].action, 'importClosedTabs');
    assert.equal(context.statsReloads, 0);
    assert.equal(context.statuses[0].type, 'error');
});

// Fill the settings fields as a user would before saving.
function fillSettings(context, overrides = {}) {
    context.fieldValues = { maxHistorySize: '500', itemsPerPage: '10', popupWidth: '500', popupHeight: '480', ...overrides };
    vm.runInContext(`
        maxHistorySizeInput = { value: fieldValues.maxHistorySize };
        itemsPerPageInput = { value: fieldValues.itemsPerPage };
        popupWidthInput = { value: fieldValues.popupWidth };
        popupHeightInput = { value: fieldValues.popupHeight };
        themeDarkInput = { checked: true };
    `, context);
}

for (const field of ['maxHistorySize', 'itemsPerPage', 'popupWidth', 'popupHeight']) {
    for (const invalid of ['', ' ', '1.5', '20garbage', 'Infinity', '-1', '99999']) {
        test(`invalid ${field}=${JSON.stringify(invalid)} never saves or trims`, () => {
            const { context, requests, writes } = loadOptions();
            fillSettings(context, { [field]: invalid });
            vm.runInContext('saveConfig()', context);
            assert.equal(writes.length, 0);
            assert.equal(requests.length, 0);
            assert.equal(context.statuses[0].type, 'error');
        });
    }
}

test('valid settings are saved before history is trimmed', () => {
    const { context, requests, writes } = loadOptions();
    fillSettings(context);
    vm.runInContext('saveConfig()', context);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].config.maxHistorySize, 500);
    assert.equal(requests[0].action, 'trimClosedTabs');
    assert.equal(context.statuses[0].type, 'success');
});

test('failed configuration save reports failure without trimming history', () => {
    const { context, requests } = loadOptions(undefined, { saveError: true });
    fillSettings(context);
    vm.runInContext('saveConfig()', context);
    assert.equal(requests.length, 0);
    assert.equal(context.statuses[0].type, 'error');
});

test('reset write failure does not trim or reload settings', () => {
    const { context, requests } = loadOptions(undefined, { saveError: true });
    vm.runInContext('resetConfig()', context);
    assert.equal(requests.length, 0);
    assert.equal(context.statuses[0].type, 'error');
});

test('mixed import records including null reach the authoritative background validator', () => {
    const { context, requests } = loadOptions();
    const records = [null, { id: 'one', title: 'Page', url: 'https://example.com/', closedAt: 100 }];
    context.importEvent = { target: { files: [{ content: JSON.stringify(records) }] } };
    vm.runInContext('importData(importEvent)', context);
    assert.equal(requests.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(requests[0].tabs)), records);
});

test('no usable import records reports an error instead of success', () => {
    const { context } = loadOptions({ success: true, importedCount: 0, validCount: 0 });
    context.importEvent = { target: { files: [{ content: '[null]' }] } };
    vm.runInContext('importData(importEvent)', context);
    assert.equal(context.statuses[0].type, 'error');
});

for (const [field, value] of Object.entries({ maxHistorySize: '500.5', itemsPerPage: '10.5', popupWidth: '500.5', popupHeight: '400.5' })) {
    test(`fractional ${field} within range is rejected without rounding`, () => {
        const { context, requests, writes } = loadOptions();
        fillSettings(context, { [field]: value });
        vm.runInContext('saveConfig()', context);
        assert.equal(writes.length, 0);
        assert.equal(requests.length, 0);
    });
}

for (const edge of ['min', 'max']) {
    test(`numeric settings accept all ${edge} bounds`, () => {
        const { context, writes } = loadOptions();
        const values = Object.fromEntries(Object.entries(context.ExtensionConfig.limits).map(([key, range]) => [key, String(range[edge])]));
        fillSettings(context, values);
        vm.runInContext('saveConfig()', context);
        assert.equal(writes.length, 1);
        assert.equal(context.statuses[0].type, 'success');
    });
}

test('display configuration preserves valid values and fills missing or invalid fields', () => {
    const { context } = loadOptions();
    const settings = context.ExtensionConfig;
    const raw = { itemsPerPage: settings.limits.itemsPerPage.max, popupWidth: null, popupHeight: NaN, theme: 'light' };
    const normalized = settings.normalize(raw);
    assert.equal(normalized.itemsPerPage, raw.itemsPerPage);
    assert.equal(normalized.popupWidth, settings.defaults.popupWidth);
    assert.equal(normalized.popupHeight, settings.defaults.popupHeight);
    assert.equal(normalized.maxHistorySize, settings.defaults.maxHistorySize);
    assert.equal(normalized.theme, 'light');
    assert.equal(raw.popupWidth, null);
});
