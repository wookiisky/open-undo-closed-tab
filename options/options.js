// options.js - Options page logic

// Default configuration
const DEFAULT_CONFIG = ExtensionConfig.defaults;

// DOM elements
let maxHistorySizeInput;
let itemsPerPageInput;
let popupWidthInput;
let popupHeightInput;
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
        const config = ExtensionConfig.normalize(result.config);

        maxHistorySizeInput.value = config.maxHistorySize;
        itemsPerPageInput.value = config.itemsPerPage;
        popupWidthInput.value = config.popupWidth;
        popupHeightInput.value = config.popupHeight;
        
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
    const fields = {
        maxHistorySize: maxHistorySizeInput,
        itemsPerPage: itemsPerPageInput,
        popupWidth: popupWidthInput,
        popupHeight: popupHeightInput
    };
    const values = {};
    for (const [key, input] of Object.entries(fields)) {
        const value = Number(input.value);
        if (!ExtensionConfig.isValidNumber(key, value)) {
            const { min, max } = ExtensionConfig.limits[key];
            showStatus('error', chrome.i18n.getMessage('invalidSetting', [
                chrome.i18n.getMessage(key), String(min), String(max)
            ]));
            input.focus?.();
            return;
        }
        values[key] = value;
    }

    const theme = themeDarkInput.checked ? 'dark' : 'light';

    const config = { ...values, theme };

    chrome.storage.sync.set({ config }, () => {
        if (chrome.runtime.lastError) {
            showStatus('error', chrome.i18n.getMessage('settingsSaveFailed'));
            return;
        }
        // Apply the limit even when returning to the default history size.
        trimHistory(() => showStatus('success', chrome.i18n.getMessage('settingsSaved')));
    });
}

// Trim history records exceeding limit
function trimHistory(onSuccess) {
    chrome.runtime.sendMessage({ action: 'trimClosedTabs' }, (response) => {
        if (chrome.runtime.lastError || !response?.success) {
            showStatus('error', chrome.i18n.getMessage('historyUpdateFailed'));
            return;
        }
        loadStats();
        if (onSuccess) onSuccess();
    });
}

// Reset to default configuration
function resetConfig() {
    if (confirm(chrome.i18n.getMessage('confirmSettingsReset'))) {
        chrome.storage.sync.set({ config: DEFAULT_CONFIG }, () => {
            if (chrome.runtime.lastError) {
                showStatus('error', chrome.i18n.getMessage('settingsSaveFailed'));
                return;
            }
            loadConfig();
            trimHistory(() => showStatus('success', chrome.i18n.getMessage('settingsReset')));
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
                showStatus('error', chrome.i18n.getMessage('invalidImportFormat'));
                return;
            }

            // The worker merges and saves atomically with respect to tab closures.
            chrome.runtime.sendMessage({ action: 'importClosedTabs', tabs: importedTabs }, (response) => {
                if (chrome.runtime.lastError || !response?.success) {
                    showStatus('error', chrome.i18n.getMessage('historyUpdateFailed'));
                    return;
                }
                if (response.validCount === 0) {
                    showStatus('error', chrome.i18n.getMessage('noValidImportData'));
                    return;
                }
                loadStats();
                showStatus('success', chrome.i18n.getMessage('importSuccess', String(response.importedCount)));
            });

        } catch (error) {
            showStatus('error', chrome.i18n.getMessage('importFailed', error.message));
        }
    };

    reader.onerror = () => showStatus('error', chrome.i18n.getMessage('importReadFailed'));
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
