const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

// 创建可共享的 Chrome 存储，模拟 worker 重启时数据仍然存在。
function createStorage(initial = {}) {
  return {
    local: structuredClone(initial.local || {}),
    session: structuredClone(initial.session || {}),
    sync: structuredClone(initial.sync || { config: { maxHistorySize: 500 } })
  };
}

// 创建受测试控制的异步操作。
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

// 同时支持 Chrome API 的回调与 Promise 调用形式。
function complete(operation, callback) {
  const promise = Promise.resolve().then(operation);
  if (callback) {
    promise.then(callback);
    return undefined;
  }
  return promise;
}

// 创建事件，并收集异步监听器的错误，避免测试进程出现未处理拒绝。
function createEvent(errors) {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    emit(...args) {
      for (const listener of listeners) {
        try {
          Promise.resolve(listener(...args)).catch(error => errors.push(error));
        } catch (error) {
          errors.push(error);
        }
      }
    },
    listeners
  };
}

// 加载真实后台脚本，Chrome API、时间与启动查询由测试控制。
function createHarness(options = {}) {
  const storage = options.storage || createStorage(options);
  const errors = [];
  const logs = [];
  const failures = [];
  const gates = [];
  const calls = [];
  const tabs = new Map((options.tabs || []).map(tab => [tab.id, structuredClone(tab)]));
  let nextTabId = Math.max(0, ...tabs.keys()) + 1;
  let now = options.now ?? 1000;
  const queryGate = options.deferQuery ? deferred() : null;
  const chrome = {
    tabs: {
      onCreated: createEvent(errors),
      onUpdated: createEvent(errors),
      onRemoved: createEvent(errors),
      onActivated: createEvent(errors),
      onReplaced: createEvent(errors),
      query(query, callback) {
        const snapshot = structuredClone([...tabs.values()]);
        return complete(async () => {
          if (queryGate) await queryGate.promise;
          return snapshot;
        }, callback);
      },
      create(properties, callback) {
        calls.push({ area: 'tabs', method: 'create', argument: structuredClone(properties) });
        return complete(async () => {
          const gateIndex = gates.findIndex(entry => entry.area === 'tabs' && entry.method === 'create');
          if (gateIndex !== -1) await gates.splice(gateIndex, 1)[0].gate.promise;
          const failureIndex = failures.findIndex(entry => entry.area === 'tabs' && entry.method === 'create');
          if (failureIndex !== -1) throw failures.splice(failureIndex, 1)[0].error;
          while (tabs.has(nextTabId)) nextTabId++;
          const tab = { id: nextTabId++, title: properties.url, ...properties };
          tabs.set(tab.id, structuredClone(tab));
          chrome.tabs.onCreated.emit(structuredClone(tab));
          return structuredClone(tab);
        }, callback);
      },
      get(tabId, callback) {
        return complete(() => {
          if (!tabs.has(tabId)) throw new Error('No tab with id');
          return structuredClone(tabs.get(tabId));
        }, callback);
      }
    },
    runtime: {
      onInstalled: createEvent(errors),
      onStartup: createEvent(errors),
      onMessage: createEvent(errors)
    },
    storage: {}
  };

  for (const area of ['local', 'session', 'sync']) {
    chrome.storage[area] = {};
    for (const method of ['get', 'set', 'remove', 'clear']) {
      chrome.storage[area][method] = (argument, callback) => {
        calls.push({ area, method, argument: structuredClone(argument) });
        return complete(async () => {
          const gateIndex = gates.findIndex(entry => entry.area === area && entry.method === method);
          if (gateIndex !== -1) await gates.splice(gateIndex, 1)[0].gate.promise;
          const failureIndex = failures.findIndex(entry => entry.area === area && entry.method === method);
          if (failureIndex !== -1) throw failures.splice(failureIndex, 1)[0].error;
          if (method === 'get') {
            if (argument === null || argument === undefined) return structuredClone(storage[area]);
            const keys = typeof argument === 'string' ? [argument] :
              Array.isArray(argument) ? argument : Object.keys(argument);
            const result = {};
            for (const key of keys) {
              if (Object.hasOwn(storage[area], key)) result[key] = structuredClone(storage[area][key]);
              else if (typeof argument === 'object' && !Array.isArray(argument)) result[key] = argument[key];
            }
            return result;
          }
          if (method === 'set') Object.assign(storage[area], structuredClone(argument));
          if (method === 'remove') {
            for (const key of Array.isArray(argument) ? argument : [argument]) delete storage[area][key];
          }
          if (method === 'clear') storage[area] = {};
        }, callback);
      };
    }
  }

  // 让关闭事件使用测试指定的时间，不依赖实际执行速度。
  class ControlledDate extends Date {
    // 返回当前测试时刻。
    static now() { return now; }
  }

  const context = vm.createContext({
    chrome,
    console: Object.fromEntries(['log', 'warn', 'error', 'info'].map(level =>
      [level, (...args) => logs.push({ level, args })])),
    Date: ControlledDate,
    Map, Set, Promise, Math, Object, Array, JSON, Number, String, Boolean,
    crypto: webcrypto,
    setTimeout, clearTimeout, queueMicrotask
  });
  context.importScripts = (...scripts) => {
    for (const script of scripts) {
      const filename = path.join(__dirname, '../..', script);
      vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    }
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../background.js'), 'utf8'), context);

  return {
    chrome, storage, errors, logs, calls,
    setTime(value) { now = value; },
    releaseQuery() { queryGate?.resolve(); },
    failNext(area, method) { failures.push({ area, method, error: new Error('模拟存储失败') }); },
    delayNext(area, method) {
      const gate = deferred();
      gates.push({ area, method, gate });
      return () => gate.resolve();
    },
    update(tabId, changeInfo, tab) {
      tabs.set(tabId, structuredClone(tab));
      chrome.tabs.onUpdated.emit(tabId, changeInfo, structuredClone(tab));
    },
    create(tab) {
      tabs.set(tab.id, structuredClone(tab));
      chrome.tabs.onCreated.emit(structuredClone(tab));
    },
    close(tabId) {
      tabs.delete(tabId);
      chrome.tabs.onRemoved.emit(tabId, { windowId: 1, isWindowClosing: false });
    },
    async idle() {
      // 每轮让 Promise 链与事件回调完成，不依赖实际时间延迟。
      for (let index = 0; index < 12; index++) await new Promise(setImmediate);
    },
    request(message) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`消息未响应: ${message.action}`)), 500);
        const respond = response => {
          clearTimeout(timeout);
          resolve(structuredClone(response));
        };
        for (const listener of chrome.runtime.onMessage.listeners) listener(message, {}, respond);
      });
    }
  };
}

module.exports = { createHarness, createStorage };
