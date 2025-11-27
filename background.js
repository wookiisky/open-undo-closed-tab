// Background service worker - Listen for tab closures and store them

// Default configuration
const DEFAULT_CONFIG = {
  maxHistorySize: 500,
  itemsPerPage: 20,
  popupWidth: 400,
  popupHeight: 600,
  removeAfterRestore: false
};

// Initialize: set default configuration
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get('config', (result) => {
    if (!result.config) {
      chrome.storage.sync.set({ config: DEFAULT_CONFIG });
    }
  });
});

// Listen for tab close events
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  // Get closed tab information
  // Note: Cannot directly get tab info in onRemoved event, need to record it beforehand
  // So we use onUpdated to track tab information
});

// Listen for tab updates, record tab information for use when closing
const tabsCache = new Map();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Filter Chrome internal pages
  if (isInternalPage(tab.url)) {
    return;
  }
  
  // Cache tab information
  if (changeInfo.status === 'complete' || changeInfo.title) {
    tabsCache.set(tabId, {
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl
    });
  }
});

// Listen for tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (!isInternalPage(tab.url)) {
    tabsCache.set(activeInfo.tabId, {
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl
    });
  }
});

// Improved close listener
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const tabInfo = tabsCache.get(tabId);
  
  if (!tabInfo || !tabInfo.url) {
    return;
  }
  
  // Filter Chrome internal pages
  if (isInternalPage(tabInfo.url)) {
    tabsCache.delete(tabId);
    return;
  }
  
  // Create closed record
  const closedTab = {
    id: `${Date.now()}_${generateUUID()}`,
    title: tabInfo.title || 'Untitled',
    url: tabInfo.url,
    closedAt: Date.now(),
    favIconUrl: tabInfo.favIconUrl
  };
  
  // Save to storage
  await saveClosedTab(closedTab);
  
  // Remove from cache
  tabsCache.delete(tabId);
});

// Check if it's an internal page
function isInternalPage(url) {
  if (!url) return true;
  
  const internalPrefixes = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'chrome-devtools://',
    'view-source:',
    'file://'
  ];
  
  return internalPrefixes.some(prefix => url.startsWith(prefix));
}

// Generate simple UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Save closed tab
async function saveClosedTab(closedTab) {
  // Get configuration
  const configResult = await chrome.storage.sync.get('config');
  const config = configResult.config || DEFAULT_CONFIG;
  
  // Get existing closed tabs list
  const result = await chrome.storage.local.get('closedTabs');
  let closedTabs = result.closedTabs || [];
  
  // Add to the beginning of the list (newest first)
  closedTabs.unshift(closedTab);
  
  // Limit quantity
  if (closedTabs.length > config.maxHistorySize) {
    closedTabs = closedTabs.slice(0, config.maxHistorySize);
  }
  
  // Save
  await chrome.storage.local.set({ closedTabs });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getClosedTabs') {
    chrome.storage.local.get('closedTabs', (result) => {
      sendResponse({ closedTabs: result.closedTabs || [] });
    });
    return true; // Keep message channel open
  }
  
  if (request.action === 'removeClosedTab') {
    chrome.storage.local.get('closedTabs', async (result) => {
      let closedTabs = result.closedTabs || [];
      closedTabs = closedTabs.filter(tab => tab.id !== request.tabId);
      await chrome.storage.local.set({ closedTabs });
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (request.action === 'clearAllClosedTabs') {
    chrome.storage.local.set({ closedTabs: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});
