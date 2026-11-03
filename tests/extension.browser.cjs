const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// Poll asynchronous extension storage reads until the expected state is committed.
async function waitForState(page, predicate, argument) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        if (await page.evaluate(predicate, argument)) return;
        await delay(20);
    }
    throw new Error('Timed out waiting for committed extension state');
}

// Read the toolbar popup target, which Playwright does not expose as a normal page.
async function readNativePopup(cdp, sessionId) {
    const reply = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cdp.off('Target.receivedMessageFromTarget', receive);
            reject(new Error('Native popup did not answer the DOM probe'));
        }, 5000);
        // Each probe owns its target session, so command id 1 is unambiguous.
        function receive(event) {
            if (event.sessionId !== sessionId) return;
            const message = JSON.parse(event.message);
            if (message.id !== 1) return;
            clearTimeout(timeout);
            cdp.off('Target.receivedMessageFromTarget', receive);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result.result.value);
        }
        cdp.on('Target.receivedMessageFromTarget', receive);
    });
    await cdp.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({
            id: 1, method: 'Runtime.evaluate', params: {
                expression: `JSON.stringify({
                    title: document.querySelector('.tab-title')?.textContent,
                    rows: document.querySelectorAll('.tab-item').length,
                    documentMs: performance.now()
                })`,
                returnByValue: true
            }
        })
    });
    return JSON.parse(await reply);
}

// Verify the real extension in an isolated profile; no user history is accessed.
async function verifyExtension() {
    const extension = path.resolve(__dirname, '..');
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'closed-tabs-browser-'));
    const server = http.createServer((request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><title>Initial title</title><p>Tab fixture</p>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const pageErrors = [];
    let context;
    try {
        context = await chromium.launchPersistentContext(profile, {
            channel: 'chromium', headless: true,
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
            args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
        });
        context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        const extensionUrl = worker.url().replace('/background.js', '');
        const control = await context.newPage();
        await control.goto(`${extensionUrl}/options/options.html`);
        await control.locator('#maxHistorySize').fill('5000');
        await control.locator('#saveBtn').click();
        await waitForState(control, async () => (await chrome.storage.sync.get('config')).config.maxHistorySize === 5000);

        const tab = await context.newPage();
        await tab.goto(`${baseUrl}/initial`);
        await tab.evaluate(() => {
            document.title = 'Latest title';
            history.replaceState({}, '', '/final');
        });
        await tab.close();
        await waitForState(control, async url =>
            (await chrome.storage.local.get('closedTabs')).closedTabs?.some(tab => tab.url === url), `${baseUrl}/final`);
        const original = await control.evaluate(async () => (await chrome.storage.local.get('closedTabs')).closedTabs[0]);
        assert.equal(original.title, 'Latest title');
        assert.equal(original.url, `${baseUrl}/final`);

        const popup = await context.newPage();
        await popup.goto(`${extensionUrl}/popup/popup.html`);
        await popup.locator('.tab-title').first().waitFor();
        assert.equal(await popup.locator('.tab-title').first().innerText(), 'Latest title');
        const duplicate = await context.newPage();
        await duplicate.goto(`${baseUrl}/final`);
        await duplicate.evaluate(() => { document.title = 'Latest title again'; });
        await duplicate.close();
        await popup.waitForFunction(() => document.querySelector('.tab-title')?.textContent === 'Latest title again');
        const records = await control.evaluate(async () => (await chrome.storage.local.get('closedTabs')).closedTabs);
        assert.equal(records.length, 1);
        assert.equal(records[0].id, original.id);

        const rapidTabs = await Promise.all([1, 2, 3].map(async number => {
            const page = await context.newPage();
            await page.goto(`${baseUrl}/rapid-${number}`);
            return page;
        }));
        await Promise.all(rapidTabs.map(page => page.close()));
        await waitForState(control, async () => (await chrome.storage.local.get('closedTabs')).closedTabs?.length === 4);
        const rapidRecords = await control.evaluate(async () => (await chrome.storage.local.get('closedTabs')).closedTabs);
        assert.deepEqual(rapidRecords.map(tab => tab.closedAt), rapidRecords.map(tab => tab.closedAt).sort((a, b) => b - a));

        const preserved = await context.newPage();
        await preserved.goto(`${baseUrl}/survive`);
        await preserved.evaluate(() => { document.title = 'Before worker stop'; });
        await waitForState(control, async () => Object.values(await chrome.storage.session.get(null))
            .some(tab => tab.title === 'Before worker stop'));
        const cdp = await context.newCDPSession(control);
        await cdp.send('ServiceWorker.enable');
        await cdp.send('ServiceWorker.stopAllWorkers');
        await preserved.close();
        await waitForState(control, async url => (await chrome.storage.local.get('closedTabs')).closedTabs
            ?.some(tab => tab.url === url && tab.title === 'Before worker stop'), `${baseUrl}/survive`);

        // Exercise the real settings file input, background merge, and sorted trimming.
        await control.locator('#maxHistorySize').fill('10');
        await control.locator('#saveBtn').click();
        await waitForState(control, async () => (await chrome.storage.sync.get('config')).config.maxHistorySize === 10);
        const imported = Array.from({ length: 15 }, (_, index) => ({
            id: `import-${index}`, title: `Imported ${index}`, url: `${baseUrl}/import-${index}`,
            closedAt: Date.now() + index * 1000
        }));
        await control.locator('#importFile').setInputFiles({
            name: 'history.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported))
        });
        await waitForState(control, async () => (await chrome.storage.local.get('closedTabs')).closedTabs?.[0]?.id === 'import-14');
        const importedRecords = await control.evaluate(async () => (await chrome.storage.local.get('closedTabs')).closedTabs);
        assert.equal(importedRecords.length, 10);
        assert.deepEqual(importedRecords.map(tab => tab.id), imported.slice(5).reverse().map(tab => tab.id));
        await popup.waitForFunction(() => document.querySelector('.tab-title')?.textContent === 'Imported 14');
        const restoredPage = context.waitForEvent('page');
        await popup.locator('.tab-item').first().click();
        const restored = await restoredPage;
        await restored.waitForURL(`${baseUrl}/import-14`);
        await waitForState(control, async () => !(await chrome.storage.local.get('closedTabs')).closedTabs
            .some(tab => tab.id === 'import-14'));
        await popup.close();

        // Invalid numeric settings must not alter saved settings or trim any history.
        const protectedState = await control.evaluate(async () => ({
            config: (await chrome.storage.sync.get('config')).config,
            history: (await chrome.storage.local.get('closedTabs')).closedTabs
        }));
        for (const field of ['maxHistorySize', 'itemsPerPage', 'popupWidth', 'popupHeight']) {
            for (const value of ['', `${protectedState.config[field]}.5`]) {
                await control.evaluate(() => { document.querySelector('#status').className = 'status'; });
                await control.locator(`#${field}`).fill(value);
                await control.locator('#saveBtn').click();
                await control.waitForFunction(() => document.querySelector('#status').classList.contains('error'));
                assert.deepEqual(await control.evaluate(async () => ({
                    config: (await chrome.storage.sync.get('config')).config,
                    history: (await chrome.storage.local.get('closedTabs')).closedTabs
                })), protectedState, `Invalid ${field} must preserve configuration and history`);
                await control.locator(`#${field}`).fill(String(protectedState.config[field]));
            }
        }

        // An entirely invalid import must not trim history that already exceeds the configured limit.
        const overLimitHistory = Array.from({ length: 12 }, (_, index) => ({
            id: `protected-${index}`, title: `Protected ${index}`, url: `${baseUrl}/protected-${index}`,
            closedAt: index + 1
        }));
        await control.evaluate(async closedTabs => {
            const { config } = await chrome.storage.sync.get('config');
            await chrome.storage.sync.set({ config: { ...config, maxHistorySize: 10 } });
            await chrome.storage.local.set({ closedTabs });
            document.querySelector('#status').className = 'status';
        }, overLimitHistory);
        await control.locator('#importFile').setInputFiles({
            name: 'invalid.json', mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify([null, { id: 'bad', title: 123, url: 456, closedAt: 'yesterday' }]))
        });
        await control.waitForFunction(() => document.querySelector('#status').classList.contains('error'));
        assert.deepEqual(await control.evaluate(async () => (await chrome.storage.local.get('closedTabs')).closedTabs),
            overLimitHistory, 'A rejected import must not reorder, trim, or overwrite existing records');

        // Literal search must retain original text and never interpret HTML or regular expressions.
        const literalTitle = 'C++ [literal]. & <tag> A.*';
        await control.evaluate(async ({ literalTitle, baseUrl }) => {
            await chrome.storage.local.set({ closedTabs: [
                { id: 'literal', title: literalTitle, url: `${baseUrl}/literal`, closedAt: Date.now() }
            ] });
        }, { literalTitle, baseUrl });
        const regressionPopup = await context.newPage();
        await regressionPopup.goto(`${extensionUrl}/popup/popup.html`);
        await regressionPopup.locator('.tab-title').waitFor();
        for (const query of ['[', 'C++', '.', '&', '<tag>', '.*']) {
            await regressionPopup.locator('#searchInput').fill(query);
            await regressionPopup.waitForFunction(query => {
                const matches = [...document.querySelectorAll('.tab-title .highlight')];
                return matches.length > 0 && matches.every(node => node.textContent === query);
            }, query);
            assert.equal(await regressionPopup.locator('.tab-title').textContent(), literalTitle);
            assert.equal(await regressionPopup.locator('.tab-title tag').count(), 0);
        }
        await regressionPopup.locator('#searchInput').fill('');
        await regressionPopup.waitForFunction(() => !document.querySelector('.highlight'));

        // Import validation is checked through the real file input and extension message boundary.
        await control.evaluate(() => chrome.storage.local.set({ closedTabs: [] }));
        const conflictingImport = [
            null,
            { id: 'invalid', title: 123, url: 456, closedAt: 'yesterday' },
            { id: 'same', title: 'Conflict newest', url: `${baseUrl}/conflict-new`, closedAt: 200 },
            { id: 'same', title: 'Conflict older', url: `${baseUrl}/conflict-old`, closedAt: 100 }
        ];
        await control.locator('#importFile').setInputFiles({
            name: 'conflicts.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(conflictingImport))
        });
        await waitForState(control, async () => (await chrome.storage.local.get('closedTabs')).closedTabs?.length === 2);
        const conflicts = await control.evaluate(async () => (await chrome.storage.local.get('closedTabs')).closedTabs);
        assert.equal(new Set(conflicts.map(record => record.id)).size, 2);
        assert.deepEqual(conflicts.map(record => record.title), ['Conflict newest', 'Conflict older']);
        await regressionPopup.waitForFunction(() => document.querySelector('.tab-title')?.textContent === 'Conflict newest');
        const conflictPagePromise = context.waitForEvent('page');
        await regressionPopup.locator('.tab-item').first().click();
        const conflictPage = await conflictPagePromise;
        await conflictPage.waitForURL(`${baseUrl}/conflict-new`);
        await waitForState(control, async () => (await chrome.storage.local.get('closedTabs')).closedTabs?.length === 1);
        assert.equal(await control.evaluate(async () => (await chrome.storage.local.get('closedTabs')).closedTabs[0].url),
            `${baseUrl}/conflict-old`);

        // Sample viewport coverage during continuous scroll events, before scrolling stops.
        await control.evaluate(async () => {
            const { config } = await chrome.storage.sync.get('config');
            await chrome.storage.sync.set({ config: { ...config, maxHistorySize: 5000, itemsPerPage: 100 } });
            await chrome.storage.local.set({ closedTabs: Array.from({ length: 200 }, (_, index) => ({
                id: `scroll-${index}`, title: `Scroll ${index}`, url: `https://example.com/scroll-${index}`,
                closedAt: 200 - index
            })) });
        });
        await regressionPopup.reload();
        await regressionPopup.locator('.tab-title').first().waitFor();
        const scrollResult = await regressionPopup.evaluate(() => new Promise(resolve => {
            const wrapper = document.querySelector('#virtualScrollWrapper');
            const firstRows = new Set();
            let samples = 0;
            let uncoveredFrames = 0;
            const started = performance.now();
            const timer = setInterval(() => { wrapper.scrollTop += 24; }, 8);
            function sample() {
                const rows = [...document.querySelectorAll('.tab-item')];
                const viewport = wrapper.getBoundingClientRect();
                if (rows.length) {
                    firstRows.add(rows[0].textContent);
                    const first = rows[0].getBoundingClientRect();
                    const last = rows[rows.length - 1].getBoundingClientRect();
                    if (first.top > viewport.top + 1 || last.bottom < viewport.bottom - 1) uncoveredFrames++;
                } else uncoveredFrames++;
                samples++;
                if (performance.now() - started < 450) requestAnimationFrame(sample);
                else {
                    clearInterval(timer);
                    resolve({ samples, firstRows: firstRows.size, uncoveredFrames, scrollTop: wrapper.scrollTop });
                }
            }
            requestAnimationFrame(sample);
        }));
        assert.ok(scrollResult.samples > 5 && scrollResult.firstRows > 3, JSON.stringify(scrollResult));
        assert.equal(scrollResult.uncoveredFrames, 0, JSON.stringify(scrollResult));
        // Change page while a scroll callback can still be pending; old rows must not reappear.
        await regressionPopup.evaluate(() => {
            const wrapper = document.querySelector('#virtualScrollWrapper');
            wrapper.scrollTop += 10;
            wrapper.dispatchEvent(new Event('scroll'));
            document.querySelector('#nextBtn').click();
        });
        await regressionPopup.waitForFunction(() => document.querySelector('.tab-title')?.textContent === 'Scroll 100');
        await regressionPopup.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await regressionPopup.locator('.tab-title').first().textContent(), 'Scroll 100');
        assert.equal(await regressionPopup.locator('#virtualScrollWrapper').evaluate(node => node.scrollTop), 0);
        await regressionPopup.close();

        // Time concurrent closures with a full history, including browser close and persistence work.
        const bulkCount = 30;
        const bulkPages = [];
        for (let index = 0; index < bulkCount; index++) {
            const page = await context.newPage();
            await page.goto(`${baseUrl}/bulk-${index}`);
            bulkPages.push(page);
        }
        await waitForState(control, async count => Object.values(await chrome.storage.session.get(null))
            .filter(tab => tab.url?.includes('/bulk-')).length === count, bulkCount);
        await control.evaluate(async () => {
            const { config } = await chrome.storage.sync.get('config');
            await chrome.storage.sync.set({ config: { ...config, maxHistorySize: 5000 } });
            await chrome.storage.local.set({ closedTabs: Array.from({ length: 5000 }, (_, index) => ({
                id: `bulk-history-${index}`, title: `Existing ${index}`, url: `https://example.com/existing-${index}`,
                closedAt: index + 1
            })) });
        });
        const bulkStarted = performance.now();
        await Promise.all(bulkPages.map(page => page.close()));
        await waitForState(control, async count => (await chrome.storage.local.get('closedTabs')).closedTabs
            .filter(tab => tab.url.includes('/bulk-')).length === count, bulkCount);
        const bulkCloseResult = {
            initialRecords: 5000, closedTabs: bulkCount, samples: 1,
            totalMs: +(performance.now() - bulkStarted).toFixed(1),
            finalRecords: await control.evaluate(async () => (await chrome.storage.local.get('closedTabs')).closedTabs.length)
        };
        assert.equal(bulkCloseResult.finalRecords, 5000);

        const performanceResults = [];
        for (const count of [500, 5000]) {
            await control.evaluate(async count => {
                await chrome.storage.sync.set({ config: {
                    maxHistorySize: 5000, itemsPerPage: 20, popupWidth: 400, popupHeight: 480, theme: 'dark'
                } });
                const closedTabs = Array.from({ length: count }, (_, index) => {
                    const rank = index * 1543 % count;
                    return { id: String(rank), title: `History ${rank}`, url: `https://example.com/${rank}`, closedAt: rank + 1 };
                });
                await chrome.storage.local.set({ closedTabs });
            }, count);
            for (const coldWorker of [false, true]) {
                const samples = [];
                const renderedRows = [];
                for (let index = 0; index < 10; index++) {
                    if (coldWorker) await cdp.send('ServiceWorker.stopAllWorkers');
                    const menu = await context.newPage();
                    await menu.setViewportSize({ width: 400, height: 480 });
                    await menu.addInitScript(() => {
                        const observer = new MutationObserver(() => {
                            if (!document.querySelector('.tab-item')) return;
                            observer.disconnect();
                            requestAnimationFrame(() => requestAnimationFrame(() => {
                                window.firstListPaintMs = performance.now();
                            }));
                        });
                        observer.observe(document, { childList: true, subtree: true });
                    });
                    await menu.goto(`${extensionUrl}/popup/popup.html`);
                    await menu.waitForFunction(() => window.firstListPaintMs > 0);
                    const sample = await menu.evaluate(() => ({
                        ms: window.firstListPaintMs, rows: document.querySelectorAll('.tab-item').length,
                        title: document.querySelector('.tab-title').textContent
                    }));
                    assert.equal(sample.title, `History ${count - 1}`);
                    assert.ok(sample.rows <= 20, 'First render should only build the visible page');
                    samples.push(sample.ms);
                    renderedRows.push(sample.rows);
                    await menu.close();
                }
                samples.sort((a, b) => a - b);
                performanceResults.push({
                    records: count, coldWorker, samples: samples.length,
                    medianMs: +samples[4].toFixed(1), p95Ms: +samples[9].toFixed(1),
                    maxRenderedRows: Math.max(...renderedRows)
                });
            }
        }
        // Open the actual toolbar action; this includes browser-side opening work.
        const browserCdp = await context.browser().newBrowserCDPSession();
        const nativePopupResults = [];
        for (const coldWorker of [false, true]) {
            const samples = [];
            for (let index = 0; index < 10; index++) {
                if (coldWorker) await cdp.send('ServiceWorker.stopAllWorkers');
                await control.bringToFront();
                const started = performance.now();
                await control.evaluate(() => chrome.action.openPopup());
                const targets = (await browserCdp.send('Target.getTargets')).targetInfos;
                const target = targets.find(target => target.url === `${extensionUrl}/popup/popup.html`);
                assert.ok(target, 'The toolbar action must create its native popup target');
                const { sessionId } = await browserCdp.send('Target.attachToTarget', {
                    targetId: target.targetId, flatten: false
                });
                let sample;
                const deadline = Date.now() + 5000;
                do {
                    sample = await readNativePopup(browserCdp, sessionId);
                    if (sample.rows) break;
                    await delay(5);
                } while (Date.now() < deadline);
                assert.equal(sample.title, 'History 4999');
                assert.ok(sample.rows <= 20);
                samples.push(performance.now() - started);
                await browserCdp.send('Target.closeTarget', { targetId: target.targetId });
                await control.bringToFront();
                // Chrome needs to finish dismissing the browser-owned action view.
                await delay(300);
            }
            samples.sort((a, b) => a - b);
            nativePopupResults.push({
                records: 5000, coldWorker, samples: samples.length,
                medianMs: +samples[4].toFixed(1), p95Ms: +samples[9].toFixed(1)
            });
        }
        // Restore from the real browser-owned popup; tab activation may destroy its document.
        await control.evaluate(async baseUrl => {
            await chrome.storage.local.set({ closedTabs: [
                { id: 'native-restore', title: 'Native restore', url: `${baseUrl}/native-restore`, closedAt: Date.now() }
            ] });
        }, baseUrl);
        await control.bringToFront();
        await control.evaluate(() => chrome.action.openPopup());
        const restoreTargets = (await browserCdp.send('Target.getTargets')).targetInfos;
        const restoreTarget = restoreTargets.find(target => target.url === `${extensionUrl}/popup/popup.html`);
        assert.ok(restoreTarget, 'The native popup must exist before restoring a tab');
        const { sessionId: restoreSession } = await browserCdp.send('Target.attachToTarget', {
            targetId: restoreTarget.targetId, flatten: false
        });
        let restoreSample;
        const restoreDeadline = Date.now() + 5000;
        do {
            restoreSample = await readNativePopup(browserCdp, restoreSession);
            if (restoreSample.rows) break;
            await delay(5);
        } while (Date.now() < restoreDeadline);
        assert.equal(restoreSample.title, 'Native restore');
        const nativeRestoredPage = context.waitForEvent('page');
        // Do not wait for an evaluation result from a popup that may already have closed.
        await browserCdp.send('Target.sendMessageToTarget', {
            sessionId: restoreSession,
            message: JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: {
                expression: "document.querySelector('.tab-item').click()"
            } })
        });
        const nativeRestored = await nativeRestoredPage;
        await nativeRestored.waitForURL(`${baseUrl}/native-restore`);
        await waitForState(control, async () => (await chrome.storage.local.get('closedTabs')).closedTabs?.length === 0);

        assert.deepEqual(pageErrors, []);
        console.log(JSON.stringify({
            browser: context.browser().version(),
            passed: ['latest title and URL', 'duplicate URL', 'live popup updates', 'concurrent closes',
                'worker stop and restart', 'import and trim', 'restore and remove', 'invalid settings preserve history',
                'literal search highlighting', 'import validation and unique ids', 'continuous scroll and page switch',
                'invalid import preserves over-limit history', 'native popup restore and remove'],
            scrollResult,
            bulkCloseResult,
            performanceResults,
            nativePopupResults
        }, null, 2));
    } finally {
        await context?.close();
        await new Promise(resolve => server.close(resolve));
        await fs.rm(profile, { recursive: true, force: true });
    }
}

verifyExtension().catch(error => { console.error(error); process.exitCode = 1; });
