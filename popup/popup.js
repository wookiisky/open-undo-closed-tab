// popup.js - Popup page logic

// Global state
let allClosedTabs = [];
let filteredTabs = [];
let currentPage = 1;
// Ignore an initial read if a newer storage event already supplied the history.
let historyRevision = 0;
// Storage updates may arrive while the initial configuration is still loading.
let popupReady = false;
let config = { ...ExtensionConfig.defaults };

// DOM elements
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

// Virtual scroll configuration
const DEFAULT_ITEM_HEIGHT = 42; // Preferred height per item
const MIN_ITEM_HEIGHT = 26; // Compact height to fit default popup size
const BUFFER_SIZE = 5; // Buffer size (5 items above and below)
let itemHeight = DEFAULT_ITEM_HEIGHT;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Get DOM elements
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

    chrome.storage.onChanged.addListener(handleHistoryChange);

    // Start both local reads together; opening the popup need not wake the worker.
    await Promise.all([loadConfig(), loadClosedTabs()]);

    // Apply popup size configuration
    applyPopupSize();

    // Bind events
    bindEvents();

    // Initial render
    popupReady = true;
    renderCurrentPage();
});

// Load configuration
async function loadConfig() {
    return new Promise((resolve) => {
        chrome.storage.sync.get('config', (result) => {
            config = ExtensionConfig.normalize(result.config);
            // Apply theme
            applyTheme(config.theme);
            resolve();
        });
    });
}

// Apply theme
function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme || 'dark');
}

// Apply popup size
function applyPopupSize() {
    if (config.popupWidth && config.popupHeight) {
        document.body.style.width = `${config.popupWidth}px`;
        document.body.style.height = `${config.popupHeight}px`;
    }
    document.documentElement.style.setProperty('--item-height', `${itemHeight}px`);
}

// Adjust item height so a full page fits when possible
function updateItemSizing() {
    const availableHeight = (virtualScrollWrapper?.clientHeight) ||
        (listContainer?.clientHeight) || 0;

    if (!availableHeight || !config?.itemsPerPage) {
        return;
    }

    const fitHeight = Math.floor(availableHeight / config.itemsPerPage);
    const targetHeight = Math.max(
        MIN_ITEM_HEIGHT,
        Math.min(DEFAULT_ITEM_HEIGHT, fitHeight || DEFAULT_ITEM_HEIGHT)
    );

    itemHeight = targetHeight;

    const useCompact = targetHeight < DEFAULT_ITEM_HEIGHT;
    document.body.classList.toggle('compact', useCompact);

    document.documentElement.style.setProperty('--item-height', `${itemHeight}px`);
}

// Load closed tabs
async function loadClosedTabs() {
    const revision = historyRevision;
    return new Promise((resolve) => {
        chrome.storage.local.get('closedTabs', (result) => {
            if (revision === historyRevision) updateClosedTabs(result.closedTabs || []);
            resolve();
        });
    });
}

// Sort once before searching or paginating the records.
function updateClosedTabs(tabs) {
    allClosedTabs = tabs.sort((a, b) => b.closedAt - a.closedAt);
    filteredTabs = allClosedTabs;
}

// Show a just-saved closure without making the initial render wait for the worker.
function handleHistoryChange(changes, area) {
    if (area !== 'local' || !changes.closedTabs) return;
    historyRevision++;
    updateClosedTabs(changes.closedTabs.newValue || []);
    if (!popupReady) return;
    if (searchInput.value.trim()) {
        handleSearch(searchInput.value);
    } else {
        currentPage = Math.max(1, Math.min(currentPage, getTotalPages()));
        renderCurrentPage();
    }
}

// Bind events
function bindEvents() {
    // Search box - use debounce
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            handleSearch(e.target.value);
        }, 300);
    });

    // Pagination buttons
    prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderCurrentPage();
        }
    });

    nextBtn.addEventListener('click', () => {
        const totalPages = getTotalPages();
        if (currentPage < totalPages) {
            currentPage++;
            renderCurrentPage();
        }
    });

    // Settings button
    settingsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    // Virtual scroll
    virtualScrollWrapper.addEventListener('scroll', handleScroll);
}

// Handle search
function handleSearch(query) {
    const lowerQuery = query.toLowerCase().trim();

    if (!lowerQuery) {
        filteredTabs = allClosedTabs;
    } else {
        filteredTabs = allClosedTabs.filter(tab => {
            const titleMatch = tab.title.toLowerCase().includes(lowerQuery);
            const urlMatch = tab.url.toLowerCase().includes(lowerQuery);
            return titleMatch || urlMatch;
        });
    }

    // Reset to first page
    currentPage = 1;
    renderCurrentPage();
}

// Get total pages
function getTotalPages() {
    return Math.ceil(filteredTabs.length / config.itemsPerPage);
}

// Calculate page numbers to display (max 5, current page in the middle)
function calculatePageNumbers(currentPage, totalPages) {
    if (totalPages <= 5) {
        // Total pages not exceeding 5, show all pages
        return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    // Total pages exceeding 5, smart display
    if (currentPage <= 3) {
        // Current page in first 3 pages, show first 5 pages
        return [1, 2, 3, 4, 5];
    } else if (currentPage >= totalPages - 2) {
        // Current page in last 3 pages, show last 5 pages
        return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    } else {
        // Current page in the middle, show 2 pages before and after
        return [currentPage - 2, currentPage - 1, currentPage, currentPage + 1, currentPage + 2];
    }
}

// Render page numbers
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
        });
        pageNumbersContainer.appendChild(pageLink);
    });
}

// Render current page
function renderCurrentPage() {
    // Discard work scheduled for the previous page or search results.
    if (scrollFrame !== null) {
        cancelAnimationFrame(scrollFrame);
        scrollFrame = null;
    }
    const totalPages = getTotalPages();

    // Update pagination info
    pageInfo.textContent = `${currentPage} / ${totalPages || 1}`;
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
    
    // Render page numbers
    renderPageNumbers(currentPage, totalPages);

    // Get current page data
    const startIndex = (currentPage - 1) * config.itemsPerPage;
    const endIndex = startIndex + config.itemsPerPage;
    const currentPageTabs = filteredTabs.slice(startIndex, endIndex);

    // Show/hide empty state
    if (filteredTabs.length === 0) {
        emptyState.style.display = 'flex';
        virtualScrollWrapper.style.display = 'none';
        return;
    } else {
        emptyState.style.display = 'none';
        virtualScrollWrapper.style.display = 'block';
    }

    // Adjust row height so a page fits without a scrollbar when possible
    updateItemSizing();

    // Render using virtual scroll
    renderVirtualList(currentPageTabs);
}

// Virtual scroll render
function renderVirtualList(tabs) {
    // Set total scroll area height
    const totalHeight = tabs.length * itemHeight;
    scrollSpacer.style.height = `${totalHeight}px`;

    // Reset scroll position
    virtualScrollWrapper.scrollTop = 0;

    // Reset visible range, force re-render
    currentVisibleRange = { start: -1, end: -1 };

    renderVisibleItems(tabs, 0);
}

// Render visible items (virtual scroll)
let currentVisibleRange = { start: 0, end: 0 };

function renderVisibleItems(tabs, scrollTop) {
    const containerHeight = virtualScrollWrapper.clientHeight;

    // Calculate visible range
    const startIndex = Math.floor(scrollTop / itemHeight);
    const endIndex = Math.ceil((scrollTop + containerHeight) / itemHeight);

    // Add buffer
    const bufferedStart = Math.max(0, startIndex - BUFFER_SIZE);
    const bufferedEnd = Math.min(tabs.length, endIndex + BUFFER_SIZE);

    // If range unchanged, don't re-render
    if (bufferedStart === currentVisibleRange.start && bufferedEnd === currentVisibleRange.end) {
        return;
    }

    currentVisibleRange = { start: bufferedStart, end: bufferedEnd };

    // Clear and render new visible items
    scrollContent.innerHTML = '';

    // Set offset
    scrollContent.style.transform = `translateY(${bufferedStart * itemHeight}px)`;

    const fragment = document.createDocumentFragment();
    for (let i = bufferedStart; i < bufferedEnd; i++) {
        const item = createTabItem(tabs[i]);
        fragment.appendChild(item);
    }

    scrollContent.appendChild(fragment);
}

// Coalesce scroll events into one render per frame without postponing that frame.
let scrollFrame = null;
function handleScroll() {
    if (scrollFrame !== null) return;
    scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        const startIndex = (currentPage - 1) * config.itemsPerPage;
        const endIndex = startIndex + config.itemsPerPage;
        const currentPageTabs = filteredTabs.slice(startIndex, endIndex);

        renderVisibleItems(currentPageTabs, virtualScrollWrapper.scrollTop);
    });
}

// Create tab item
function createTabItem(tab) {
    const item = document.createElement('div');
    item.className = 'tab-item';
    item.style.height = `${itemHeight}px`;

    // Icon
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

    // Info container
    const info = document.createElement('div');
    info.className = 'tab-info';

    // Title
    const title = document.createElement('div');
    title.className = 'tab-title';
    title.appendChild(highlightText(tab.title, searchInput.value));

    // URL
    const url = document.createElement('div');
    url.className = 'tab-url';
    url.appendChild(highlightText(tab.url, searchInput.value));

    info.appendChild(title);
    info.appendChild(url);

    // Time
    const time = document.createElement('div');
    time.className = 'tab-time';
    time.textContent = formatTime(tab.closedAt);

    item.appendChild(favicon);
    item.appendChild(info);
    item.appendChild(time);

    // Click event
    item.addEventListener('click', () => {
        openTab(tab);
    });

    return item;
}

// Match literal text before creating nodes, so HTML and regex syntax stay ordinary text.
function highlightText(text, query) {
    const fragment = document.createDocumentFragment();
    const needle = query.trim().toLowerCase();
    const lowerText = text.toLowerCase();
    let match = needle ? lowerText.indexOf(needle) : -1;
    if (match === -1) {
        fragment.appendChild(document.createTextNode(text));
        return fragment;
    }

    // Some characters expand when lowercased (İ → i + combining dot).
    // Map only those strings back to original offsets to preserve their visible text.
    let starts;
    let ends;
    if (lowerText.length !== text.length) {
        starts = [];
        ends = [];
        let offset = 0;
        for (const character of text) {
            const length = character.toLowerCase().length;
            for (let index = 0; index < length; index++) {
                starts.push(offset);
                ends.push(offset + character.length);
            }
            offset += character.length;
        }
    }

    let cursor = 0;
    while (match !== -1) {
        const start = starts ? starts[match] : match;
        const end = ends ? ends[match + needle.length - 1] : match + needle.length;
        if (start >= cursor) {
            fragment.appendChild(document.createTextNode(text.slice(cursor, start)));
            const highlight = document.createElement('span');
            highlight.className = 'highlight';
            highlight.textContent = text.slice(start, end);
            fragment.appendChild(highlight);
            cursor = end;
        }
        match = lowerText.indexOf(needle, match + needle.length);
    }
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
    return fragment;
}

// Format time
function formatTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) {
        return 'just now';
    } else if (minutes < 60) {
        return `${minutes} min ago`;
    } else if (hours < 24) {
        return `${hours} hr ago`;
    } else if (days < 7) {
        return `${days} days ago`;
    } else {
        const date = new Date(timestamp);
        return `${date.getMonth() + 1}/${date.getDate()}`;
    }
}

// Get default favicon
function getDefaultFavicon() {
    // Use SVG data URL as default icon
    return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="2" fill="%23555"/><text x="8" y="12" font-size="10" text-anchor="middle" fill="%23fff">📄</text></svg>';
}

// Keep duplicate clicks from creating multiple tabs while restoration is pending.
const openingTabIds = new Set();

// Let the worker finish restoration even when opening a tab closes this popup.
async function openTab(tab) {
    if (openingTabIds.has(tab.id)) return;
    openingTabIds.add(tab.id);
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'restoreClosedTab',
            tabId: tab.id
        });
        if (!response?.success) {
            const message = response?.created === false ? 'unableOpenUrl' : 'historyUpdateFailed';
            alert(chrome.i18n.getMessage(message));
        }
    } catch (error) {
        console.error('标签恢复失败', error);
        alert(chrome.i18n.getMessage('historyUpdateFailed'));
    } finally {
        openingTabIds.delete(tab.id);
    }
}
