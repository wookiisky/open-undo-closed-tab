// popup.js - 弹出页面逻辑

// 全局状态
let allClosedTabs = [];
let filteredTabs = [];
let currentPage = 1;
let config = {
    maxHistorySize: 500,
    itemsPerPage: 20,
    popupWidth: 400,
    popupHeight: 600,
    removeAfterRestore: false,
    theme: 'dark'
};

// DOM元素
let searchInput;
let listContainer;
let virtualScrollWrapper;
let scrollSpacer;
let scrollContent;
let emptyState;
let prevBtn;
let nextBtn;
let pageInfo;
let pageNumbersContainer;
let settingsBtn;

// 虚拟滚动配置
const ITEM_HEIGHT = 42; // 每项固定高度（更紧凑）
const BUFFER_SIZE = 5; // 缓冲区大小（上下各5项）

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 获取DOM元素
    searchInput = document.getElementById('searchInput');
    listContainer = document.getElementById('listContainer');
    virtualScrollWrapper = document.getElementById('virtualScrollWrapper');
    scrollSpacer = document.getElementById('scrollSpacer');
    scrollContent = document.getElementById('scrollContent');
    emptyState = document.getElementById('emptyState');
    prevBtn = document.getElementById('prevBtn');
    nextBtn = document.getElementById('nextBtn');
    pageInfo = document.getElementById('pageInfo');
    pageNumbersContainer = document.getElementById('pageNumbers');
    settingsBtn = document.getElementById('settingsBtn');

    // 加载配置
    await loadConfig();

    // 应用弹层尺寸配置
    applyPopupSize();

    // 加载数据
    await loadClosedTabs();

    // 绑定事件
    bindEvents();

    // 初始渲染
    renderCurrentPage();
});

// 加载配置
async function loadConfig() {
    return new Promise((resolve) => {
        chrome.storage.sync.get('config', (result) => {
            if (result.config) {
                config = { ...config, ...result.config };
            }
            // 应用主题
            applyTheme(config.theme);
            resolve();
        });
    });
}

// 应用主题
function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme || 'dark');
}

// 应用弹层尺寸
function applyPopupSize() {
    if (config.popupWidth && config.popupHeight) {
        document.body.style.width = `${config.popupWidth}px`;
        document.body.style.height = `${config.popupHeight}px`;
    }
}

// 加载关闭的标签页
async function loadClosedTabs() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getClosedTabs' }, (response) => {
            allClosedTabs = response.closedTabs || [];
            filteredTabs = [...allClosedTabs];
            resolve();
        });
    });
}

// 绑定事件
function bindEvents() {
    // 搜索框 - 使用防抖
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            handleSearch(e.target.value);
        }, 300);
    });

    // 分页按钮
    prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderCurrentPage();
            scrollToTop();
        }
    });

    nextBtn.addEventListener('click', () => {
        const totalPages = getTotalPages();
        if (currentPage < totalPages) {
            currentPage++;
            renderCurrentPage();
            scrollToTop();
        }
    });

    // 设置按钮
    settingsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    // 虚拟滚动
    virtualScrollWrapper.addEventListener('scroll', handleScroll);
}

// 处理搜索
function handleSearch(query) {
    const lowerQuery = query.toLowerCase().trim();

    if (!lowerQuery) {
        filteredTabs = [...allClosedTabs];
    } else {
        filteredTabs = allClosedTabs.filter(tab => {
            const titleMatch = tab.title.toLowerCase().includes(lowerQuery);
            const urlMatch = tab.url.toLowerCase().includes(lowerQuery);
            return titleMatch || urlMatch;
        });
    }

    // 重置到第一页
    currentPage = 1;
    renderCurrentPage();
}

// 获取总页数
function getTotalPages() {
    return Math.ceil(filteredTabs.length / config.itemsPerPage);
}

// 计算要显示的页码数组（最多5个，当前页在中间）
function calculatePageNumbers(currentPage, totalPages) {
    if (totalPages <= 5) {
        // 总页数不超过5个，显示所有页码
        return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    // 总页数超过5个，智能显示
    if (currentPage <= 3) {
        // 当前页在前3页，显示前5页
        return [1, 2, 3, 4, 5];
    } else if (currentPage >= totalPages - 2) {
        // 当前页在后3页，显示后5页
        return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    } else {
        // 当前页在中间，显示前后各2页
        return [currentPage - 2, currentPage - 1, currentPage, currentPage + 1, currentPage + 2];
    }
}

// 渲染分页数字
function renderPageNumbers(currentPageNum, totalPages) {
    pageNumbersContainer.innerHTML = '';
    
    if (totalPages <= 1) {
        return;
    }

    const pageNumbers = calculatePageNumbers(currentPageNum, totalPages);
    
    pageNumbers.forEach(pageNum => {
        const pageLink = document.createElement('span');
        pageLink.className = 'page-number';
        if (pageNum === currentPageNum) {
            pageLink.classList.add('active');
        }
        pageLink.textContent = pageNum;
        pageLink.addEventListener('click', () => {
            currentPage = pageNum;
            renderCurrentPage();
            scrollToTop();
        });
        pageNumbersContainer.appendChild(pageLink);
    });
}

// 渲染当前页
function renderCurrentPage() {
    const totalPages = getTotalPages();

    // 更新分页信息
    pageInfo.textContent = `${currentPage} / ${totalPages || 1}`;
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
    
    // 渲染分页数字
    renderPageNumbers(currentPage, totalPages);

    // 获取当前页的数据
    const startIndex = (currentPage - 1) * config.itemsPerPage;
    const endIndex = startIndex + config.itemsPerPage;
    const currentPageTabs = filteredTabs.slice(startIndex, endIndex);

    // 显示/隐藏空状态
    if (filteredTabs.length === 0) {
        emptyState.style.display = 'flex';
        virtualScrollWrapper.style.display = 'none';
        return;
    } else {
        emptyState.style.display = 'none';
        virtualScrollWrapper.style.display = 'block';
    }

    // 使用虚拟滚动渲染
    renderVirtualList(currentPageTabs);
}

// 虚拟滚动渲染
function renderVirtualList(tabs) {
    // 设置滚动区域总高度
    const totalHeight = tabs.length * ITEM_HEIGHT;
    scrollSpacer.style.height = `${totalHeight}px`;

    // 重置滚动位置
    virtualScrollWrapper.scrollTop = 0;

    // 重置可见范围，强制重新渲染
    currentVisibleRange = { start: -1, end: -1 };

    // 如果项目少于一屏，直接全部渲染
    if (tabs.length <= 10) {
        renderAllItems(tabs);
    } else {
        // 初始渲染可见项
        renderVisibleItems(tabs, 0);
    }
}

// 渲染所有项（少量数据时）
function renderAllItems(tabs) {
    scrollContent.innerHTML = '';
    scrollContent.style.transform = 'translateY(0px)';

    const fragment = document.createDocumentFragment();
    tabs.forEach((tab, index) => {
        const item = createTabItem(tab, index);
        fragment.appendChild(item);
    });

    scrollContent.appendChild(fragment);
}

// 渲染可见项（虚拟滚动）
let currentVisibleRange = { start: 0, end: 0 };

function renderVisibleItems(tabs, scrollTop) {
    const containerHeight = virtualScrollWrapper.clientHeight;

    // 计算可见范围
    const startIndex = Math.floor(scrollTop / ITEM_HEIGHT);
    const endIndex = Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT);

    // 添加缓冲区
    const bufferedStart = Math.max(0, startIndex - BUFFER_SIZE);
    const bufferedEnd = Math.min(tabs.length, endIndex + BUFFER_SIZE);

    // 如果范围没变，不重新渲染
    if (bufferedStart === currentVisibleRange.start && bufferedEnd === currentVisibleRange.end) {
        return;
    }

    currentVisibleRange = { start: bufferedStart, end: bufferedEnd };

    // 清空并渲染新的可见项
    scrollContent.innerHTML = '';

    // 设置偏移
    scrollContent.style.transform = `translateY(${bufferedStart * ITEM_HEIGHT}px)`;

    const fragment = document.createDocumentFragment();
    for (let i = bufferedStart; i < bufferedEnd; i++) {
        const item = createTabItem(tabs[i], i);
        fragment.appendChild(item);
    }

    scrollContent.appendChild(fragment);
}

// 处理滚动事件
let scrollTimeout;
function handleScroll() {
    clearTimeout(scrollTimeout);

    scrollTimeout = setTimeout(() => {
        const startIndex = (currentPage - 1) * config.itemsPerPage;
        const endIndex = startIndex + config.itemsPerPage;
        const currentPageTabs = filteredTabs.slice(startIndex, endIndex);

        if (currentPageTabs.length > 10) {
            const scrollTop = virtualScrollWrapper.scrollTop;
            renderVisibleItems(currentPageTabs, scrollTop);
        }
    }, 16); // ~60fps
}

// 创建标签页项
function createTabItem(tab, index) {
    const item = document.createElement('div');
    item.className = 'tab-item';
    item.style.height = `${ITEM_HEIGHT}px`;

    // 图标
    const favicon = document.createElement('img');
    favicon.className = 'tab-favicon';
    if (tab.favIconUrl) {
        favicon.src = tab.favIconUrl;
        favicon.onerror = () => {
            favicon.src = getDefaultFavicon();
            favicon.classList.add('default-icon');
        };
    } else {
        favicon.src = getDefaultFavicon();
        favicon.classList.add('default-icon');
    }

    // 信息容器
    const info = document.createElement('div');
    info.className = 'tab-info';

    // 标题
    const title = document.createElement('div');
    title.className = 'tab-title';
    title.innerHTML = highlightText(tab.title, searchInput.value);

    // URL
    const url = document.createElement('div');
    url.className = 'tab-url';
    url.innerHTML = highlightText(tab.url, searchInput.value);

    info.appendChild(title);
    info.appendChild(url);

    // 时间
    const time = document.createElement('div');
    time.className = 'tab-time';
    time.textContent = formatTime(tab.closedAt);

    item.appendChild(favicon);
    item.appendChild(info);
    item.appendChild(time);

    // 点击事件
    item.addEventListener('click', () => {
        openTab(tab);
    });

    return item;
}

// 高亮文本
function highlightText(text, query) {
    if (!query || !query.trim()) {
        return escapeHtml(text);
    }

    const escapedText = escapeHtml(text);
    const escapedQuery = escapeHtml(query.trim());
    const regex = new RegExp(`(${escapedQuery})`, 'gi');

    return escapedText.replace(regex, '<span class="highlight">$1</span>');
}

// 转义HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 格式化时间
function formatTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) {
        return '刚刚';
    } else if (minutes < 60) {
        return `${minutes}分钟前`;
    } else if (hours < 24) {
        return `${hours}小时前`;
    } else if (days < 7) {
        return `${days}天前`;
    } else {
        const date = new Date(timestamp);
        return `${date.getMonth() + 1}/${date.getDate()}`;
    }
}

// 获取默认图标
function getDefaultFavicon() {
    // 使用SVG data URL作为默认图标
    return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="2" fill="%23555"/><text x="8" y="12" font-size="10" text-anchor="middle" fill="%23fff">📄</text></svg>';
}

// 打开标签页
async function openTab(tab) {
    try {
        await chrome.tabs.create({ url: tab.url });

        // 如果配置为恢复后删除
        if (config.removeAfterRestore) {
            chrome.runtime.sendMessage({
                action: 'removeClosedTab',
                tabId: tab.id
            }, async () => {
                // 重新加载数据
                await loadClosedTabs();

                // 如果当前搜索框有内容，重新应用搜索
                if (searchInput.value.trim()) {
                    handleSearch(searchInput.value);
                } else {
                    renderCurrentPage();
                }
            });
        }
    } catch (error) {
        console.error('打开标签页失败:', error);
        alert('无法打开此URL');
    }
}

// 滚动到顶部
function scrollToTop() {
    virtualScrollWrapper.scrollTop = 0;
}
