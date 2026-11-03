importScripts('shared/config.js');
const DEFAULT_CONFIG = ExtensionConfig.defaults;

// Keep only the latest snapshot of each open tab, including across worker restarts.
const SNAPSHOT_PREFIX = 'activeTab_';
// Last observed page data, including updates whose persistence failed.
const tabsCache = new Map();
// Failed session writes must retry even when a later update repeats the same data.
const unsavedSnapshotIds = new Set();
// Snapshot initialization and writes must preserve tab event order.
let snapshotQueue = initializeSnapshots().catch(error => console.error('页面状态初始化失败', error));
// All history mutations use this queue; snapshot updates never delay history reads.
let historyQueue = Promise.resolve();

chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.sync.get('config');
  if (!result.config) await chrome.storage.sync.set({ config: DEFAULT_CONFIG });
});

chrome.tabs.onCreated.addListener(tab => {
  enqueueSnapshot(() => rememberTab(tab));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!['url', 'title', 'favIconUrl'].some(field => Object.hasOwn(changeInfo, field))) return;
  // URL events carry the current committed URL; pending navigation does not replace it.
  enqueueSnapshot(() => rememberTab(tab));
});

chrome.tabs.onRemoved.addListener(tabId => {
  // Capture event time before any asynchronous initialization or storage work.
  const closedAt = Date.now();
  const snapshot = enqueueSnapshot(async () => {
    const tab = tabsCache.get(tabId);
    tabsCache.delete(tabId);
    unsavedSnapshotIds.delete(tabId);
    try {
      await chrome.storage.session.remove(`${SNAPSHOT_PREFIX}${tabId}`);
    } catch (error) {
      // A session cleanup failure must not discard the closed-page record.
      console.error('页面状态清理失败', error);
    }
    return tab;
  });

  enqueueHistory(async () => {
    const tab = await snapshot;
    if (!tab || isInternalPage(tab.url)) return;
    await saveClosedTab({
      ...tab,
      id: `${closedAt}_${crypto.randomUUID()}`,
      title: tab.title || tab.url,
      closedAt
    });
  });
});

// Load session snapshots before replaying events received during startup.
async function initializeSnapshots() {
  const [storedResult, tabsResult] = await Promise.allSettled([
    chrome.storage.session.get(null),
    chrome.tabs.query({})
  ]);
  const stored = storedResult.status === 'fulfilled' ? storedResult.value : {};
  if (storedResult.status === 'rejected') console.error('页面状态读取失败', storedResult.reason);
  for (const [key, snapshot] of Object.entries(stored)) {
    if (key.startsWith(SNAPSHOT_PREFIX)) {
      tabsCache.set(Number(key.slice(SNAPSHOT_PREFIX.length)), snapshot);
    }
  }
  if (tabsResult.status === 'rejected') {
    console.error('活动标签查询失败', tabsResult.reason);
    return;
  }

  const snapshots = {};
  for (const tab of tabsResult.value) {
    if (!tab.url) continue;
    if (isInternalPage(tab.url)) {
      tabsCache.delete(tab.id);
      continue;
    }
    const snapshot = tabSnapshot(tab);
    tabsCache.set(tab.id, snapshot);
    snapshots[`${SNAPSHOT_PREFIX}${tab.id}`] = snapshot;
    unsavedSnapshotIds.add(tab.id);
  }
  // Keep missing tabs in memory until queued close events consume their snapshots.
  const staleKeys = Object.keys(stored).filter(key =>
    key.startsWith(SNAPSHOT_PREFIX) && !Object.hasOwn(snapshots, key));
  const writes = await Promise.allSettled([
    Object.keys(snapshots).length ? chrome.storage.session.set(snapshots) : undefined,
    staleKeys.length ? chrome.storage.session.remove(staleKeys) : undefined
  ]);
  if (writes[0].status === 'fulfilled') unsavedSnapshotIds.clear();
  // A failed cleanup must not let a still-pending startup write overwrite new events.
  for (const result of writes) {
    if (result.status === 'rejected') console.error('页面状态初始化写入失败', result.reason);
  }
}

// Serialize snapshot work and allow later events to continue after an API failure.
function enqueueSnapshot(operation) {
  const result = snapshotQueue.then(operation);
  snapshotQueue = result.catch(error => console.error('页面状态更新失败', error));
  return result;
}

// Serialize history operations and keep the queue usable after a failed write.
function enqueueHistory(operation) {
  const result = historyQueue.then(operation);
  historyQueue = result.catch(error => console.error('关闭记录处理失败', error));
  return result;
}

// Extract only the committed page information needed when a tab closes.
function tabSnapshot(tab) {
  return { title: tab.title || '', url: tab.url, favIconUrl: tab.favIconUrl || '' };
}

// Overwrite a tab's last snapshot only when the visible page information changes.
async function rememberTab(tab) {
  // A missing committed URL can occur while a newly created tab is navigating.
  if (!tab.url) return;
  const key = `${SNAPSHOT_PREFIX}${tab.id}`;
  if (isInternalPage(tab.url)) {
    tabsCache.delete(tab.id);
    unsavedSnapshotIds.delete(tab.id);
    await chrome.storage.session.remove(key);
    return;
  }
  const snapshot = tabSnapshot(tab);
  const previous = tabsCache.get(tab.id);
  if (!unsavedSnapshotIds.has(tab.id) && previous && previous.title === snapshot.title && previous.url === snapshot.url &&
      previous.favIconUrl === snapshot.favIconUrl) return;
  tabsCache.set(tab.id, snapshot);
  unsavedSnapshotIds.add(tab.id);
  await chrome.storage.session.set({ [key]: snapshot });
  unsavedSnapshotIds.delete(tab.id);
}

// Preserve the existing exclusions for browser and local pages.
function isInternalPage(url) {
  if (!url) return true;
  return [
    'chrome://', 'chrome-extension://', 'edge://', 'about:',
    'chrome-devtools://', 'view-source:', 'file://'
  ].some(prefix => url.startsWith(prefix));
}

// Load stored order; mutations sort once at the write boundary.
async function readClosedTabs() {
  const result = await chrome.storage.local.get('closedTabs');
  return result.closedTabs || [];
}

// Reject invalid limits before truncation; unchanged history needs no storage write.
async function writeClosedTabs(closedTabs, previousTabs) {
  const result = await chrome.storage.sync.get('config');
  const limit = result.config && Object.hasOwn(result.config, 'maxHistorySize')
    ? result.config.maxHistorySize : DEFAULT_CONFIG.maxHistorySize;
  if (!ExtensionConfig.isValidNumber('maxHistorySize', limit)) {
    throw new Error('历史数量上限无效');
  }
  const nextTabs = [...closedTabs].sort((a, b) => b.closedAt - a.closedAt).slice(0, limit);
  if (nextTabs.length === previousTabs.length && nextTabs.every((tab, index) => tab === previousTabs[index])) return;
  await chrome.storage.local.set({ closedTabs: nextTabs });
}

// Replace a URL's older records while preserving its newest existing record's id.
async function saveClosedTab(closedTab) {
  const closedTabs = await readClosedTabs();
  let existing;
  const remaining = [];
  for (const tab of closedTabs) {
    if (tab.url !== closedTab.url) remaining.push(tab);
    else if (!existing || tab.closedAt > existing.closedAt) existing = tab;
  }
  const updated = { ...existing, ...closedTab, id: existing?.id || closedTab.id };
  // Prepending puts the later close first when timestamps share a millisecond.
  await writeClosedTabs([updated, ...remaining], closedTabs);
}

// Validate imported records once, retaining only fields used by the extension.
function normalizeImportedTab(tab) {
  if (!tab || typeof tab !== 'object' || Array.isArray(tab) ||
      typeof tab.id !== 'string' || !tab.id ||
      typeof tab.title !== 'string' || !tab.title ||
      typeof tab.url !== 'string' || !tab.url ||
      !Number.isFinite(tab.closedAt)) return null;
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    closedAt: tab.closedAt,
    favIconUrl: typeof tab.favIconUrl === 'string' ? tab.favIconUrl : ''
  };
}

// Keep URL-and-time deduplication while assigning unique ids to imported records.
async function importClosedTabs(tabs) {
  if (!Array.isArray(tabs)) throw new Error('导入历史格式无效');
  const closedTabs = await readClosedTabs();
  const keys = new Set(closedTabs.map(tab => JSON.stringify([tab.url, tab.closedAt])));
  const ids = new Set(closedTabs.map(tab => tab.id));
  const newTabs = [];
  let validCount = 0;
  for (const value of tabs) {
    const tab = normalizeImportedTab(value);
    if (!tab) continue;
    validCount++;
    const key = JSON.stringify([tab.url, tab.closedAt]);
    if (keys.has(key)) continue;
    keys.add(key);
    while (ids.has(tab.id)) tab.id = crypto.randomUUID();
    ids.add(tab.id);
    newTabs.push(tab);
  }
  if (validCount > 0) await writeClosedTabs([...newTabs, ...closedTabs], closedTabs);
  return { success: true, importedCount: newTabs.length, validCount };
}

// Keep restoration alive when opening a tab closes the popup that requested it.
async function restoreClosedTab(tabId) {
  let created = false;
  try {
    const tabs = await readClosedTabs();
    const tab = tabs.find(item => item.id === tabId);
    if (!tab) return { success: true };
    await chrome.tabs.create({ url: tab.url });
    created = true;
    await writeClosedTabs(tabs.filter(item => item.id !== tabId), tabs);
    return { success: true };
  } catch (error) {
    console.error('关闭记录恢复失败', error);
    return { success: false, created };
  }
}

// Keep history writes in the worker so options and popup cannot overwrite each other.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  let operation;
  switch (request.action) {
    case 'getClosedTabs':
      operation = async () => ({ closedTabs: (await readClosedTabs()).sort((a, b) => b.closedAt - a.closedAt) });
      break;
    case 'restoreClosedTab':
      operation = () => restoreClosedTab(request.tabId);
      break;
    case 'removeClosedTab':
      operation = async () => {
        const tabs = await readClosedTabs();
        await writeClosedTabs(tabs.filter(tab => tab.id !== request.tabId), tabs);
        return { success: true };
      };
      break;
    case 'clearAllClosedTabs':
      operation = async () => {
        await chrome.storage.local.set({ closedTabs: [] });
        return { success: true };
      };
      break;
    case 'importClosedTabs':
      operation = () => importClosedTabs(request.tabs);
      break;
    case 'trimClosedTabs':
      operation = async () => {
        const tabs = await readClosedTabs();
        await writeClosedTabs(tabs, tabs);
        return { success: true };
      };
      break;
    default:
      return;
  }
  enqueueHistory(operation).then(sendResponse, () => sendResponse({ success: false }));
  return true;
});
