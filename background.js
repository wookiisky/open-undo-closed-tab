// 后台服务worker - 监听标签页关闭并存储

// 默认配置
const DEFAULT_CONFIG = {
  maxHistorySize: 500,
  itemsPerPage: 20,
  popupWidth: 400,
  popupHeight: 600,
  removeAfterRestore: false
};

// 初始化：设置默认配置
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get('config', (result) => {
    if (!result.config) {
      chrome.storage.sync.set({ config: DEFAULT_CONFIG });
    }
  });
});

// 监听标签页关闭事件
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  // 获取被关闭的标签页信息
  // 注意：在onRemoved事件中无法直接获取tab信息，需要在beforeunload时记录
  // 所以我们使用onUpdated来追踪标签页信息
});

// 监听标签页更新，记录标签页信息以便关闭时使用
const tabsCache = new Map();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 过滤Chrome内部页面
  if (isInternalPage(tab.url)) {
    return;
  }
  
  // 缓存标签页信息
  if (changeInfo.status === 'complete' || changeInfo.title) {
    tabsCache.set(tabId, {
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl
    });
  }
});

// 监听标签页激活
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

// 改进的关闭监听
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const tabInfo = tabsCache.get(tabId);
  
  if (!tabInfo || !tabInfo.url) {
    return;
  }
  
  // 过滤Chrome内部页面
  if (isInternalPage(tabInfo.url)) {
    tabsCache.delete(tabId);
    return;
  }
  
  // 创建关闭记录
  const closedTab = {
    id: `${Date.now()}_${generateUUID()}`,
    title: tabInfo.title || '未命名',
    url: tabInfo.url,
    closedAt: Date.now(),
    favIconUrl: tabInfo.favIconUrl
  };
  
  // 保存到存储
  await saveClosedTab(closedTab);
  
  // 从缓存中移除
  tabsCache.delete(tabId);
});

// 判断是否为内部页面
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

// 生成简单的UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 保存关闭的标签页
async function saveClosedTab(closedTab) {
  // 获取配置
  const configResult = await chrome.storage.sync.get('config');
  const config = configResult.config || DEFAULT_CONFIG;
  
  // 获取现有的关闭标签页列表
  const result = await chrome.storage.local.get('closedTabs');
  let closedTabs = result.closedTabs || [];
  
  // 添加到列表开头（最新的在前）
  closedTabs.unshift(closedTab);
  
  // 限制数量
  if (closedTabs.length > config.maxHistorySize) {
    closedTabs = closedTabs.slice(0, config.maxHistorySize);
  }
  
  // 保存
  await chrome.storage.local.set({ closedTabs });
}

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getClosedTabs') {
    chrome.storage.local.get('closedTabs', (result) => {
      sendResponse({ closedTabs: result.closedTabs || [] });
    });
    return true; // 保持消息通道开启
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
