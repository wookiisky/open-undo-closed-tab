# Undo Close Tab Speed - Chrome Extension

A powerful Chrome extension for recording, searching, and restoring closed tabs.

## ✨ Main Features

- 📝 **Auto Recording**: Records the last title and committed URL reported by Chrome before a tab closes (filters Chrome internal pages)
- 🕒 **Newest First**: Sorts by close time; closing the same URL again updates its title and time
- 🔍 **Smart Search**: Quickly search in titles and URLs with highlight matching
- 📄 **Pagination**: Supports pagination for browsing large history
- ⚡ **High Performance**: Uses virtual scrolling for smooth handling of hundreds of records
- ⚙️ **Flexible Configuration**: Customizable storage limit, display count, popup dimensions, etc.
- 💾 **Data Management**: Supports export, import, and clearing history

## 🚀 Installation

Requires Chrome 102 or later.

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
   - The most recently closed tabs appear first, including after importing history
   - A navigation that has not committed yet retains the previous committed URL

2. **Restore Tabs**
   - Click any item in the list to restore that tab
   - Restored tabs are automatically removed from the history list
   - The background worker completes restoration even when opening the tab dismisses the popup

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
- **Items Per Page**: Set number of tabs to display per page in popup (5-100, default 10)

#### Popup Appearance
- **Theme Selection**: Choose dark or light theme
- **Popup Width**: Customize popup window width (300-600px, default 500px)
- **Popup Height**: Customize popup window height (200-480px, default 480px)

#### Data Management
- **Export History**: Export all history records as JSON file
- **Import History**: Import history records from JSON file (supports merge and deduplication by URL and close time). The worker skips malformed records and assigns a new internal ID when an imported ID collides, so restoring one record does not remove another
- **Clear All History**: Delete all saved history records

## 🎨 Technical Features

### Performance Optimization
- **Virtual Scrolling**: Only renders DOM elements in visible area, supports smooth scrolling through hundreds of records
- **Search Debouncing**: 300ms debounce delay reduces unnecessary calculations; highlighting treats search terms as literal text, including punctuation
- **Frame-Based Scrolling**: Coalesces scroll events into animation frames so the list updates during continuous scrolling
- **Fast Popup Loading**: Reads local history and settings in parallel without waiting for the background worker or a scan of open tabs
- **Latest Page State**: Keeps only one current title/URL snapshot per open tab in session storage, survives background worker restarts, and removes it when the tab closes
- **Consistent Writes**: Serializes closures, restores, imports, removals, and history trimming to prevent concurrent writes from overwriting each other; history mutations sort once and skip writes when the retained records have not changed
- **Shared Settings**: Uses the same defaults and numeric limits in the worker, popup, and options page. Invalid settings cannot trigger history trimming

### Design Features
- **Modern Dark Theme**: Uses gradient background and glassmorphism effects
- **Smooth Animations**: All interactions have smooth transitions
- **Responsive Design**: Adapts to different window sizes

## 📂 Project Structure

```
undo-close-tab/
├── manifest.json           # Extension configuration file
├── background.js           # Background service worker
├── shared/config.js        # Shared defaults and numeric limits
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

- All data is stored locally (`chrome.storage.local`, `chrome.storage.sync`, and temporary `chrome.storage.session` snapshots)
- No data is sent to any external servers
- Only collects closed tab information (title, URL, close time, icon)
- Automatically filters Chrome internal pages (chrome://, edge://, etc.)

## 🛠️ Development Notes

This extension is developed based on Chrome Manifest V3, main technologies:

- **Manifest V3**: Latest Chrome extension specification
- **Service Worker**: Background service, replaces traditional background page
- **Chrome Storage API**: Local and sync storage
- **Virtual Scrolling**: Self-implemented high-performance list rendering solution

### Verification

Run the regression tests with Node.js 18 or later:

```sh
node --test tests/*.test.cjs
```

The tests cover page updates, worker restarts, event ordering, concurrent history writes,
sorting before truncation, failure recovery, invalid settings, import validation and ID collisions,
literal highlighting, continuous scroll scheduling, and the popup's direct local reads.

For real Chromium verification, use an available Playwright installation and its Chromium
browser. The optional runner creates and removes an isolated browser profile, checks tab
closure/restoration and imports, and reports first-list-paint timing with 500 and 5,000
records, both with a running worker and after stopping it. It also uses Chromium's
toolbar action API to measure native popup opening with 5,000 records. Additional browser
checks cover invalid settings, literal search, mixed imports, continuous scrolling, and
batch closure persistence with 5,000 history records, and restoration from the actual
toolbar popup after it closes:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node tests/extension.browser.cjs
```

If the Playwright browser is installed at a custom path, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium` for the runner.

The document timing covers rendering the popup at its configured size. The native
popup timing starts at the toolbar action API call and ends when the DOM probe sees
the first rows, including browser opening work and probe overhead. Both run in headless
Chromium; neither establishes timing on every device or browser version.

## 📄 License

MIT License

## 🤝 Contributing

Issues and Pull Requests are welcome!
