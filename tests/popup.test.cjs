const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createPopupDom } = require('./helpers/popup-dom-fake.cjs');

// Load popup logic without opening a browser or running its DOM initialization.
function loadPopup(chrome) {
    const dom = createPopupDom();
    const alerts = [];
    const context = vm.createContext({ ...dom, chrome, alert: message => alerts.push(message), console: {error() {}} });
    const sharedPath = path.join(__dirname, '../shared/config.js');
    vm.runInContext(fs.readFileSync(sharedPath, 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8'), context);
    return { context, initialize: dom.initialize, dom, alerts };
}

test('popup reads local history directly and sorts before search or pagination', async () => {
    let reads = 0;
    const records = [
        { id: 'old', title: 'Old', url: 'https://example.com/old', closedAt: 1 },
        { id: 'new', title: 'New', url: 'https://example.com/new', closedAt: 3 },
        { id: 'middle', title: 'Middle', url: 'https://example.com/middle', closedAt: 2 }
    ];
    const { context } = loadPopup({
        storage: { local: { get: (key, callback) => { reads++; callback({ closedTabs: records }); } } },
        runtime: { sendMessage: () => assert.fail('Opening the popup must not wake the background worker') }
    });
    await vm.runInContext('loadClosedTabs()', context);
    assert.equal(reads, 1);
    assert.deepEqual(Array.from(vm.runInContext('allClosedTabs.map(tab => tab.id)', context)), ['new', 'middle', 'old']);
    assert.deepEqual(Array.from(vm.runInContext('filteredTabs.map(tab => tab.id)', context)), ['new', 'middle', 'old']);
});

test('configuration and history start loading together before the first render', async () => {
    const callbacks = {};
    const { context, initialize } = loadPopup({
        storage: {
            sync: { get: (key, callback) => { callbacks.config = callback; } },
            local: { get: (key, callback) => { callbacks.history = callback; } },
            onChanged: { addListener() {} }
        },
        runtime: { sendMessage: () => assert.fail('History must load from local storage') }
    });
    vm.runInContext(`
        applyTheme = () => {};
        applyPopupSize = () => {};
        bindEvents = () => {};
        globalThis.renderCount = 0;
        renderCurrentPage = () => { renderCount++; };
    `, context);
    const initialized = initialize();
    assert.equal(typeof callbacks.config, 'function');
    assert.equal(typeof callbacks.history, 'function');
    assert.equal(context.renderCount, 0);
    callbacks.history({ closedTabs: [] });
    callbacks.config({});
    await initialized;
    assert.equal(context.renderCount, 1);
});

test('a pending close updates an open popup without delaying its first local read', async () => {
    let onHistoryChanged;
    let historyCallback;
    const { context, initialize } = loadPopup({
        storage: {
            sync: { get: (key, callback) => callback({}) },
            local: { get: (key, callback) => { historyCallback = callback; } },
            onChanged: { addListener: listener => { onHistoryChanged = listener; } }
        }
    });
    vm.runInContext(`
        applyTheme = () => {};
        applyPopupSize = () => {};
        bindEvents = () => {};
        globalThis.renderCount = 0;
        renderCurrentPage = () => { renderCount++; };
    `, context);
    const initialized = initialize();
    assert.equal(typeof onHistoryChanged, 'function');
    const record = { id: 'pending', title: 'Pending', url: 'https://example.com/', closedAt: 100 };
    onHistoryChanged({ closedTabs: { newValue: [record] } }, 'local');
    historyCallback({ closedTabs: [] });
    await initialized;
    assert.equal(context.renderCount, 1);
    assert.equal(vm.runInContext('allClosedTabs[0].id', context), 'pending');

    vm.runInContext('searchInput.value = ""', context);
    onHistoryChanged({ closedTabs: { newValue: [] } }, 'local');
    assert.equal(context.renderCount, 2);
    assert.equal(vm.runInContext('allClosedTabs.length', context), 0);
});


for (const [text, query, expected] of [
    ['C++ [x] a.b', 'C++', ['C++']],
    ['C++ [x] a.b', '[', ['[']],
    ['C++ [x] a.b', '.', ['.']],
    ['<script>&amp; example', 'amp', ['amp', 'amp']],
    ['<script>& company', 'amp', []],
    ['<script>& company', '&', ['&']],
    ['Hello HELLO', ' hello ', ['Hello', 'HELLO']],
    ['İABC', 'abc', ['ABC']],
    ['No match', 'xyz', []],
    ['Plain <text>', '', []]
]) {
    test(`literal highlighting preserves text: ${JSON.stringify(query)}`, () => {
        const { context } = loadPopup({});
        context.sampleText = text;
        context.sampleQuery = query;
        const fragment = vm.runInContext('highlightText(sampleText, sampleQuery)', context);
        assert.equal(fragment.textContent, text);
        assert.deepEqual(Array.from(fragment.children.filter(node => node.className === 'highlight'), node => node.textContent), expected);
        assert.ok(fragment.children.every(node => node.tagName === '#text' || node.tagName === 'span'));
    });
}

test('continuous scroll events render on each frame using the latest position', () => {
    const { context, dom } = loadPopup({});
    vm.runInContext(`
        config.itemsPerPage = 100;
        filteredTabs = Array.from({length: 100}, (_, id) => ({id}));
        virtualScrollWrapper = document.getElementById('virtualScrollWrapper');
        globalThis.draws = [];
        renderVisibleItems = (tabs, top) => draws.push({first: tabs[0].id, top});
    `, context);
    for (let frame = 0; frame < 3; frame++) {
        for (let event = 0; event < 10; event++) {
            dom.document.getElementById('virtualScrollWrapper').scrollTop = frame * 100 + event;
            context.handleScroll();
        }
        assert.equal(dom.frames.size, 1);
        dom.flushFrame();
        assert.equal(context.draws.length, frame + 1);
        assert.equal(context.draws[frame].top, frame * 100 + 9);
    }
});

test('a pending scroll frame renders the new page rather than stale page data', async () => {
    const { context, dom, initialize } = loadPopup({storage: {
        sync: {get: (key, cb) => cb({config: {itemsPerPage: 20}})},
        local: {get: (key, cb) => cb({closedTabs: []})},
        onChanged: {addListener() {}}
    }});
    await initialize();
    vm.runInContext(`
        filteredTabs = Array.from({length: 40}, (_, id) => ({id, title: 'Page '+id, url: 'https://example.com/'+id, closedAt: Date.now()}));
        renderCurrentPage();
        virtualScrollWrapper.scrollTop = 400;
        handleScroll();
        currentPage = 2;
        renderCurrentPage();
    `, context);
    dom.flushFrame();
    assert.equal(dom.document.getElementById('virtualScrollWrapper').scrollTop, 0);
    const content = dom.document.getElementById('scrollContent');
    assert.match(content.children[0].textContent, /Page 20/);
    assert.equal(content.style.transform, 'translateY(0px)');
});

test('restoration delegates once to the worker and relies on storage events for refresh', async () => {
    let finishRestoration;
    const messages = [];
    const {context, alerts} = loadPopup({
        tabs: {create: () => assert.fail('The worker must create tabs after the popup closes')},
        runtime: {sendMessage: request => {
            messages.push(request);
            return new Promise(resolve => { finishRestoration = resolve; });
        }},
        storage: {local: {get: () => assert.fail('Restoring must not reload history')}},
        i18n: {getMessage: key => key}
    });
    context.record = {id: 'one', url: 'https://example.com/'};
    const first = vm.runInContext('openTab(record)', context);
    const duplicate = vm.runInContext('openTab(record)', context);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].action, 'restoreClosedTab');
    assert.equal(messages[0].tabId, 'one');
    assert.equal(Object.hasOwn(messages[0], 'url'), false);
    await duplicate;
    finishRestoration({success: true});
    await first;
    assert.deepEqual(alerts, []);
});

test('creation failure is reported and allows retry through the worker', async () => {
    let attempts = 0;
    const {context, alerts} = loadPopup({
        tabs: {create: () => assert.fail('The worker owns restoration')},
        runtime: {sendMessage: async () => {attempts++; return {success: false, created: false};}},
        i18n: {getMessage: key => key}
    });
    context.record = {id: 'one', url: 'https://example.com/'};
    await vm.runInContext('openTab(record)', context);
    await vm.runInContext('openTab(record)', context);
    assert.equal(attempts, 2);
    assert.deepEqual(alerts, ['unableOpenUrl', 'unableOpenUrl']);
});

for (const [name, respond] of [
    ['creation succeeded but removal failed', async () => ({success: false, created: true})],
    ['transport rejected without known creation state', async () => {throw new Error('worker unavailable');}],
    ['worker returned no result', async () => undefined]
]) {
    test(`restoration reports history update failure when ${name}`, async () => {
        const {context, alerts} = loadPopup({
            tabs: {create: () => assert.fail('The worker owns restoration')},
            runtime: {sendMessage: respond},
            i18n: {getMessage: key => key}
        });
        context.record = {id: 'one', url: 'https://example.com/'};
        await vm.runInContext('openTab(record)', context);
        assert.deepEqual(alerts, ['historyUpdateFailed']);
    });
}

// A repeated request may arrive after the record has already been removed.
test('an already restored record is accepted as an idempotent worker success', async () => {
    const {context, alerts} = loadPopup({
        tabs: {create: () => assert.fail('The worker owns restoration')},
        runtime: {sendMessage: async () => ({success: true, created: false})},
        i18n: {getMessage: key => key}
    });
    context.record = {id: 'removed'};
    await vm.runInContext('openTab(record)', context);
    assert.deepEqual(alerts, []);
});
