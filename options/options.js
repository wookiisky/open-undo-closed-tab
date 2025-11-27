// options.js - 配置页面逻辑

// 默认配置
const DEFAULT_CONFIG = {
    maxHistorySize: 500,
    itemsPerPage: 20,
    popupWidth: 400,
    popupHeight: 600,
    removeAfterRestore: false,
    theme: 'dark'
};

// DOM元素
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

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    // 获取DOM元素
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

    // 加载配置
    loadConfig();

    // 加载统计
    loadStats();

    // 绑定事件
    bindEvents();
});

// 加载配置
function loadConfig() {
    chrome.storage.sync.get('config', (result) => {
        const config = result.config || DEFAULT_CONFIG;

        maxHistorySizeInput.value = config.maxHistorySize;
        itemsPerPageInput.value = config.itemsPerPage;
        popupWidthInput.value = config.popupWidth;
        popupHeightInput.value = config.popupHeight;
        removeAfterRestoreInput.checked = config.removeAfterRestore;
        
        // 设置主题
        const theme = config.theme || 'dark';
        if (theme === 'dark') {
            themeDarkInput.checked = true;
        } else {
            themeLightInput.checked = true;
        }
        
        // 应用主题
        applyTheme(theme);
    });
}

// 加载统计
function loadStats() {
    chrome.storage.local.get('closedTabs', (result) => {
        const count = (result.closedTabs || []).length;
        stats.innerHTML = `当前记录数: <strong>${count}</strong>`;
    });
}

// 绑定事件
function bindEvents() {
    saveBtn.addEventListener('click', saveConfig);
    resetBtn.addEventListener('click', resetConfig);
    exportBtn.addEventListener('click', exportData);
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', importData);
    clearBtn.addEventListener('click', clearData);
    
    // 主题切换实时预览
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

// 保存配置
function saveConfig() {
    // 验证输入
    const maxHistorySize = parseInt(maxHistorySizeInput.value);
    const itemsPerPage = parseInt(itemsPerPageInput.value);
    const popupWidth = parseInt(popupWidthInput.value);
    const popupHeight = parseInt(popupHeightInput.value);

    if (maxHistorySize < 10 || maxHistorySize > 5000) {
        showStatus('error', '最大保存数量必须在10-5000之间');
        return;
    }

    if (itemsPerPage < 5 || itemsPerPage > 100) {
        showStatus('error', '每页显示数量必须在5-100之间');
        return;
    }

    if (popupWidth < 300 || popupWidth > 600) {
        showStatus('error', '弹层宽度必须在300-600之间');
        return;
    }

    if (popupHeight < 200 || popupHeight > 480) {
        showStatus('error', '弹层高度必须在200-480之间');
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
        showStatus('success', '✓ 设置已保存');

        // 如果修改了最大保存数量，需要清理超出的记录
        if (maxHistorySize !== DEFAULT_CONFIG.maxHistorySize) {
            trimHistory(maxHistorySize);
        }
    });
}

// 清理超出限制的历史记录
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

// 恢复默认配置
function resetConfig() {
    if (confirm('确定要恢复默认设置吗？')) {
        chrome.storage.sync.set({ config: DEFAULT_CONFIG }, () => {
            loadConfig();
            showStatus('success', '✓ 已恢复默认设置');
        });
    }
}

// 导出数据
function exportData() {
    chrome.storage.local.get('closedTabs', (result) => {
        const closedTabs = result.closedTabs || [];

        if (closedTabs.length === 0) {
            showStatus('error', '没有可导出的记录');
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

        showStatus('success', `✓ 已导出 ${closedTabs.length} 条记录`);
    });
}

// 导入数据
function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const importedTabs = JSON.parse(e.target.result);

            if (!Array.isArray(importedTabs)) {
                showStatus('error', '导入文件格式错误');
                return;
            }

            // 验证数据格式
            const validTabs = importedTabs.filter(tab =>
                tab.id && tab.title && tab.url && tab.closedAt
            );

            if (validTabs.length === 0) {
                showStatus('error', '导入文件中没有有效数据');
                return;
            }

            // 合并到现有数据
            chrome.storage.local.get('closedTabs', (result) => {
                let closedTabs = result.closedTabs || [];

                // 去重：根据URL和时间戳
                const existingKeys = new Set(
                    closedTabs.map(tab => `${tab.url}_${tab.closedAt}`)
                );

                const newTabs = validTabs.filter(tab =>
                    !existingKeys.has(`${tab.url}_${tab.closedAt}`)
                );

                closedTabs = [...newTabs, ...closedTabs];

                // 应用数量限制
                chrome.storage.sync.get('config', (configResult) => {
                    const config = configResult.config || DEFAULT_CONFIG;
                    if (closedTabs.length > config.maxHistorySize) {
                        closedTabs = closedTabs.slice(0, config.maxHistorySize);
                    }

                    chrome.storage.local.set({ closedTabs }, () => {
                        loadStats();
                        showStatus('success', `✓ 已导入 ${newTabs.length} 条新记录`);
                    });
                });
            });

        } catch (error) {
            showStatus('error', '导入失败：' + error.message);
        }
    };

    reader.readAsText(file);

    // 重置文件输入
    event.target.value = '';
}

// 清空所有数据
function clearData() {
    chrome.storage.local.get('closedTabs', (result) => {
        const count = (result.closedTabs || []).length;

        if (count === 0) {
            showStatus('error', '没有可清空的记录');
            return;
        }

        if (confirm(`确定要清空所有 ${count} 条记录吗？此操作无法撤销。`)) {
            chrome.runtime.sendMessage({ action: 'clearAllClosedTabs' }, (response) => {
                if (response.success) {
                    loadStats();
                    showStatus('success', '✓ 已清空所有记录');
                }
            });
        }
    });
}

// 应用主题
function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
}

// 显示状态消息
let statusTimeout;
function showStatus(type, message) {
    clearTimeout(statusTimeout);

    status.className = `status show ${type}`;
    status.textContent = message;

    statusTimeout = setTimeout(() => {
        status.classList.remove('show');
    }, 3000);
}
