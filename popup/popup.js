// popup.js - Popup page logic

// Global state
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
const ITEM_HEIGHT = 42; // Fixed height per item (compact)
const BUFFER_SIZE = 5; // Buffer size (5 items above and below)

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

    // Load configuration
    await loadConfig();

    // Apply popup size configuration
    applyPopupSize();

    // Load data
    await loadClosedTabs();

    // Bind events
    bindEvents();

    // Initial render
    renderCurrentPage();
});

// Load configuration
async function loadConfig() {
    return new Promise((resolve) => {
        chrome.storage.sync.get('config', (result) => {
            if (result.config) {
                config = { ...config, ...result.config };
            }
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
}

// Load closed tabs
async function loadClosedTabs() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getClosedTabs' }, (response) => {
            allClosedTabs = response.closedTabs || [];
            filteredTabs = [...allClosedTabs];
            resolve();
        });
    });
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
        filteredTabs = [...allClosedTabs];
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
            scrollToTop();
        });
        pageNumbersContainer.appendChild(pageLink);
    });
}

// Render current page
function renderCurrentPage() {
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

    // Render using virtual scroll
    renderVirtualList(currentPageTabs);
}

// Virtual scroll render
function renderVirtualList(tabs) {
    // Set total scroll area height
    const totalHeight = tabs.length * ITEM_HEIGHT;
    scrollSpacer.style.height = `${totalHeight}px`;

    // Reset scroll position
    virtualScrollWrapper.scrollTop = 0;

    // Reset visible range, force re-render
    currentVisibleRange = { start: -1, end: -1 };

    // If items less than one screen, render all directly
    if (tabs.length <= 10) {
        renderAllItems(tabs);
    } else {
        // Initial render of visible items
        renderVisibleItems(tabs, 0);
    }
}

// Render all items (when data is small)
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

// Render visible items (virtual scroll)
let currentVisibleRange = { start: 0, end: 0 };

function renderVisibleItems(tabs, scrollTop) {
    const containerHeight = virtualScrollWrapper.clientHeight;

    // Calculate visible range
    const startIndex = Math.floor(scrollTop / ITEM_HEIGHT);
    const endIndex = Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT);

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
    scrollContent.style.transform = `translateY(${bufferedStart * ITEM_HEIGHT}px)`;

    const fragment = document.createDocumentFragment();
    for (let i = bufferedStart; i < bufferedEnd; i++) {
        const item = createTabItem(tabs[i], i);
        fragment.appendChild(item);
    }

    scrollContent.appendChild(fragment);
}

// Handle scroll event
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

// Create tab item
function createTabItem(tab, index) {
    const item = document.createElement('div');
    item.className = 'tab-item';
    item.style.height = `${ITEM_HEIGHT}px`;

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
    title.innerHTML = highlightText(tab.title, searchInput.value);

    // URL
    const url = document.createElement('div');
    url.className = 'tab-url';
    url.innerHTML = highlightText(tab.url, searchInput.value);

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

// Highlight text
function highlightText(text, query) {
    if (!query || !query.trim()) {
        return escapeHtml(text);
    }

    const escapedText = escapeHtml(text);
    const escapedQuery = escapeHtml(query.trim());
    const regex = new RegExp(`(${escapedQuery})`, 'gi');

    return escapedText.replace(regex, '<span class="highlight">$1</span>');
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

// Open tab
async function openTab(tab) {
    try {
        await chrome.tabs.create({ url: tab.url });

        // If configured to remove after restore
        if (config.removeAfterRestore) {
            chrome.runtime.sendMessage({
                action: 'removeClosedTab',
                tabId: tab.id
            }, async () => {
                // Reload data
                await loadClosedTabs();

                // If search box has content, re-apply search
                if (searchInput.value.trim()) {
                    handleSearch(searchInput.value);
                } else {
                    renderCurrentPage();
                }
            });
        }
    } catch (error) {
        console.error('Failed to open tab:', error);
        alert('Unable to open this URL');
    }
}

// Scroll to top
function scrollToTop() {
    virtualScrollWrapper.scrollTop = 0;
}
