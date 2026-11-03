// Shared defaults and numeric limits for the worker, popup, and options page.
globalThis.ExtensionConfig = (() => {
    const defaults = Object.freeze({
        maxHistorySize: 500,
        itemsPerPage: 10,
        popupWidth: 500,
        popupHeight: 480,
        theme: 'dark'
    });
    const limits = Object.freeze({
        maxHistorySize: Object.freeze({ min: 10, max: 5000 }),
        itemsPerPage: Object.freeze({ min: 5, max: 100 }),
        popupWidth: Object.freeze({ min: 300, max: 600 }),
        popupHeight: Object.freeze({ min: 200, max: 480 })
    });

    // Accept integer values only; destructive callers must reject invalid limits.
    function isValidNumber(key, value) {
        const range = limits[key];
        return Number.isInteger(value) && value >= range.min && value <= range.max;
    }

    // Repair missing or invalid display settings without changing stored data.
    function normalize(value) {
        const config = { ...defaults };
        for (const key of Object.keys(limits)) {
            if (isValidNumber(key, value?.[key])) config[key] = value[key];
        }
        if (value?.theme === 'dark' || value?.theme === 'light') config.theme = value.theme;
        return config;
    }

    return Object.freeze({ defaults, limits, isValidNumber, normalize });
})();
