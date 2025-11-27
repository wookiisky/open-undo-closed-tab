// options.js - Options page logic

// Default configuration
const DEFAULT_CONFIG = {
    maxHistorySize: 500,
    itemsPerPage: 10,
    popupWidth: 600,
    popupHeight: 480,
    removeAfterRestore: false,
    theme: 'dark'
};

// DOM elements
let maxHistorySizeInput;
let itemsPerPageInput;
let popupWidthInput;
let popupHeightInput;
let removeAfterRestoreInput;
let themeDarkInput;
let themeLightInput;
let saveBtn;
let resetBtn;
let exportBtn;
let importBtn;
let importFile;
let clearBtn;
let status;
let stats;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements
    maxHistorySizeInput = document.getElementById('maxHistorySize');
    itemsPerPageInput = document.getElementById('itemsPerPage');
    popupWidthInput = document.getElementById('popupWidth');
    popupHeightInput = document.getElementById('popupHeight');
    removeAfterRestoreInput = document.getElementById('removeAfterRestore');
    themeDarkInput = document.getElementById('themeDark');
    themeLightInput = document.getElementById('themeLight');
    saveBtn = document.getElementById('saveBtn');
    resetBtn = document.getElementById('resetBtn');
    exportBtn = document.getElementById('exportBtn');
    importBtn = document.getElementById('importBtn');
    importFile = document.getElementById('importFile');
    clearBtn = document.getElementById('clearBtn');
    status = document.getElementById('status');
    stats = document.getElementById('stats');

    // Load configuration
    loadConfig();

    // Load statistics
    loadStats();

    // Bind events
    bindEvents();
});

// Load configuration
function loadConfig() {
    chrome.storage.sync.get('config', (result) => {
        const config = result.config || DEFAULT_CONFIG;

        maxHistorySizeInput.value = config.maxHistorySize;
        itemsPerPageInput.value = config.itemsPerPage;
        popupWidthInput.value = config.popupWidth;
        popupHeightInput.value = config.popupHeight;
        removeAfterRestoreInput.checked = config.removeAfterRestore;
        
        // Set theme
        const theme = config.theme || 'dark';
        if (theme === 'dark') {
            themeDarkInput.checked = true;
        } else {
            themeLightInput.checked = true;
        }
        
        // Apply theme
        applyTheme(theme);
    });
}

// Load statistics
function loadStats() {
    chrome.storage.local.get('closedTabs', (result) => {
        const count = (result.closedTabs || []).length;
        stats.innerHTML = `Current records: <strong>${count}</strong>`;
    });
}

// Bind events
function bindEvents() {
    saveBtn.addEventListener('click', saveConfig);
    resetBtn.addEventListener('click', resetConfig);
    exportBtn.addEventListener('click', exportData);
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', importData);
    clearBtn.addEventListener('click', clearData);
    
    // Theme switching real-time preview
    themeDarkInput.addEventListener('change', () => {
        if (themeDarkInput.checked) {
            applyTheme('dark');
        }
    });
    themeLightInput.addEventListener('change', () => {
        if (themeLightInput.checked) {
            applyTheme('light');
        }
    });
}

// Save configuration
function saveConfig() {
    // Validate input
    const maxHistorySize = parseInt(maxHistorySizeInput.value);
    const itemsPerPage = parseInt(itemsPerPageInput.value);
    const popupWidth = parseInt(popupWidthInput.value);
    const popupHeight = parseInt(popupHeightInput.value);

    if (maxHistorySize < 10 || maxHistorySize > 5000) {
        showStatus('error', 'Max history size must be between 10-5000');
        return;
    }

    if (itemsPerPage < 5 || itemsPerPage > 100) {
        showStatus('error', 'Items per page must be between 5-100');
        return;
    }

    if (popupWidth < 300 || popupWidth > 600) {
        showStatus('error', 'Popup width must be between 300-600');
        return;
    }

    if (popupHeight < 200 || popupHeight > 480) {
        showStatus('error', 'Popup height must be between 200-480');
        return;
    }

    const theme = themeDarkInput.checked ? 'dark' : 'light';

    const config = {
        maxHistorySize,
        itemsPerPage,
        popupWidth,
        popupHeight,
        removeAfterRestore: removeAfterRestoreInput.checked,
        theme
    };

    chrome.storage.sync.set({ config }, () => {
        showStatus('success', '✓ Settings saved');

        // If max history size is changed, need to trim excess records
        if (maxHistorySize !== DEFAULT_CONFIG.maxHistorySize) {
            trimHistory(maxHistorySize);
        }
    });
}

// Trim history records exceeding limit
function trimHistory(maxSize) {
    chrome.storage.local.get('closedTabs', (result) => {
        let closedTabs = result.closedTabs || [];

        if (closedTabs.length > maxSize) {
            closedTabs = closedTabs.slice(0, maxSize);
            chrome.storage.local.set({ closedTabs }, () => {
                loadStats();
            });
        }
    });
}

// Reset to default configuration
function resetConfig() {
    if (confirm('Are you sure you want to reset to default settings?')) {
        chrome.storage.sync.set({ config: DEFAULT_CONFIG }, () => {
            loadConfig();
            showStatus('success', '✓ Reset to default settings');
        });
    }
}

// Export data
function exportData() {
    chrome.storage.local.get('closedTabs', (result) => {
        const closedTabs = result.closedTabs || [];

        if (closedTabs.length === 0) {
            showStatus('error', 'No records to export');
            return;
        }

        const dataStr = JSON.stringify(closedTabs, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `undo-close-tab-export-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showStatus('success', `✓ Exported ${closedTabs.length} records`);
    });
}

// Import data
function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const importedTabs = JSON.parse(e.target.result);

            if (!Array.isArray(importedTabs)) {
                showStatus('error', 'Invalid import file format');
                return;
            }

            // Validate data format
            const validTabs = importedTabs.filter(tab =>
                tab.id && tab.title && tab.url && tab.closedAt
            );

            if (validTabs.length === 0) {
                showStatus('error', 'No valid data in import file');
                return;
            }

            // Merge with existing data
            chrome.storage.local.get('closedTabs', (result) => {
                let closedTabs = result.closedTabs || [];

                // Deduplicate: based on URL and timestamp
                const existingKeys = new Set(
                    closedTabs.map(tab => `${tab.url}_${tab.closedAt}`)
                );

                const newTabs = validTabs.filter(tab =>
                    !existingKeys.has(`${tab.url}_${tab.closedAt}`)
                );

                closedTabs = [...newTabs, ...closedTabs];

                // Apply quantity limit
                chrome.storage.sync.get('config', (configResult) => {
                    const config = configResult.config || DEFAULT_CONFIG;
                    if (closedTabs.length > config.maxHistorySize) {
                        closedTabs = closedTabs.slice(0, config.maxHistorySize);
                    }

                    chrome.storage.local.set({ closedTabs }, () => {
                        loadStats();
                        showStatus('success', `✓ Imported ${newTabs.length} new records`);
                    });
                });
            });

        } catch (error) {
            showStatus('error', 'Import failed: ' + error.message);
        }
    };

    reader.readAsText(file);

    // Reset file input
    event.target.value = '';
}

// Clear all data
function clearData() {
    chrome.storage.local.get('closedTabs', (result) => {
        const count = (result.closedTabs || []).length;

        if (count === 0) {
            showStatus('error', 'No records to clear');
            return;
        }

        if (confirm(`Are you sure you want to clear all ${count} records? This action cannot be undone.`)) {
            chrome.runtime.sendMessage({ action: 'clearAllClosedTabs' }, (response) => {
                if (response.success) {
                    loadStats();
                    showStatus('success', '✓ Cleared all records');
                }
            });
        }
    });
}

// Apply theme
function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
}

// Show status message
let statusTimeout;
function showStatus(type, message) {
    clearTimeout(statusTimeout);

    status.className = `status show ${type}`;
    status.textContent = message;

    statusTimeout = setTimeout(() => {
        status.classList.remove('show');
    }, 3000);
}
