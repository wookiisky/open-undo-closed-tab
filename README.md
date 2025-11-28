# Open Undo Close Tab - Chrome Extension

A powerful Chrome extension for recording, searching, and restoring closed tabs.

## ✨ Main Features

- 📝 **Auto Recording**: Automatically records all closed tabs (filters Chrome internal pages)
- 🔍 **Smart Search**: Quickly search in titles and URLs with highlight matching
- 📄 **Pagination**: Supports pagination for browsing large history
- ⚡ **High Performance**: Uses virtual scrolling for smooth handling of hundreds of records
- ⚙️ **Flexible Configuration**: Customizable storage limit, display count, popup dimensions, etc.
- 💾 **Data Management**: Supports export, import, and clearing history

## 🚀 Installation

1. Download or clone this repository to local
2. Open Chrome browser and visit `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked extension"
5. Select the project root directory `undo-close-tab`
6. Extension installed!

## 📖 User Guide

### Basic Usage

1. **View Closed Tabs**
   - Click the extension icon in the toolbar
   - The popup shows all closed tabs
   - Each item displays title, URL, and close time

2. **Restore Tabs**
   - Click any item in the list to restore that tab
   - Restored tabs are automatically removed from the history list

3. **Search Function**
   - Enter keywords in the top search box
   - Search filters tabs containing keywords in title or URL in real-time
   - Matching text is highlighted

4. **Pagination**
   - Use bottom pagination buttons to switch pages
   - Page number shows current page and total pages

### Advanced Configuration

Click the settings button ⚙️ in the top right of the popup to enter the configuration page:

#### Basic Settings
- **Max History Size**: Set the maximum number of closed tabs to keep (10-5000, default 500)
- **Items Per Page**: Set number of tabs to display per page in popup (5-100, default 20)

#### Popup Appearance
- **Theme Selection**: Choose dark or light theme
- **Popup Width**: Customize popup window width (300-600px, default 400px)
- **Popup Height**: Customize popup window height (200-480px, default 600px)

#### Data Management
- **Export History**: Export all history records as JSON file
- **Import History**: Import history records from JSON file (supports merge and deduplication)
- **Clear All History**: Delete all saved history records

## 🎨 Technical Features

### Performance Optimization
- **Virtual Scrolling**: Only renders DOM elements in visible area, supports smooth scrolling through hundreds of records
- **Search Debouncing**: 300ms debounce delay reduces unnecessary calculations
- **Smart Caching**: Caches tab information, reduces storage reads

### Design Features
- **Modern Dark Theme**: Uses gradient background and glassmorphism effects
- **Smooth Animations**: All interactions have smooth transitions
- **Responsive Design**: Adapts to different window sizes

## 📂 Project Structure

```
undo-close-tab/
├── manifest.json           # Extension configuration file
├── background.js           # Background service worker
├── popup/
│   ├── popup.html         # Popup page
│   ├── popup.css          # Popup page styles
│   └── popup.js           # Popup page logic (with virtual scrolling)
├── options/
│   ├── options.html       # Options page
│   ├── options.css        # Options page styles
│   └── options.js         # Options page logic
└── icons/
    ├── icon16.png         # 16x16 icon
    ├── icon32.png         # 32x32 icon
    ├── icon48.png         # 48x48 icon
    └── icon128.png        # 128x128 icon
```

## 🔒 Privacy Statement

- All data is stored locally (`chrome.storage.local` and `chrome.storage.sync`)
- No data is sent to any external servers
- Only collects closed tab information (title, URL, close time, icon)
- Automatically filters Chrome internal pages (chrome://, edge://, etc.)

## 🛠️ Development Notes

This extension is developed based on Chrome Manifest V3, main technologies:

- **Manifest V3**: Latest Chrome extension specification
- **Service Worker**: Background service, replaces traditional background page
- **Chrome Storage API**: Local and sync storage
- **Virtual Scrolling**: Self-implemented high-performance list rendering solution

## 📄 License

MIT License

## 🤝 Contributing

Issues and Pull Requests are welcome!
