const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, createStorage } = require('./helpers/chrome-fake.cjs');

// 创建完整的标签快照。
function page(id, title = `页面 ${id}`, url = `https://example.com/${id}`) {
  return { id, title, url, favIconUrl: 'https://example.com/favicon.ico' };
}

// 创建兼容现有历史格式的关闭记录。
function record(id, closedAt, url = `https://example.com/${id}`) {
  return { id, title: `记录 ${id}`, url, closedAt, favIconUrl: '' };
}

// 按真实标题更新事件准备标签，用于隔离历史写入行为。
async function track(harness, ...tabs) {
  await harness.idle();
  for (const tab of tabs) harness.update(tab.id, { title: tab.title }, tab);
  await harness.idle();
}

test('URL 单独变化后保存最后的 URL 与标题', async () => {
  const h = createHarness();
  await track(h, page(1, '初始标题'));
  h.update(1, { url: 'https://example.com/final' }, page(1, '最终标题', 'https://example.com/final'));
  h.close(1);
  await h.idle();
  assert.equal(h.storage.local.closedTabs[0].url, 'https://example.com/final');
  assert.equal(h.storage.local.closedTabs[0].title, '最终标题');
});

test('标题单独变化后保存最后标题', async () => {
  const h = createHarness();
  await track(h, page(1, '初始标题'));
  h.update(1, { title: '最终标题' }, page(1, '最终标题'));
  h.close(1);
  await h.idle();
  assert.equal(h.storage.local.closedTabs[0].title, '最终标题');
});

test('空标题覆盖旧标题，保存时使用页面 URL 作为后备标题', async () => {
  const h = createHarness();
  await track(h, page(1, '旧标题'));
  h.update(1, { title: '' }, page(1, ''));
  h.close(1);
  await h.idle();
  assert.equal(h.storage.local.closedTabs[0].title, page(1).url);
});

test('启动时查询已有标签，未切换或更新也能记录关闭', async () => {
  const h = createHarness({ tabs: [page(1)] });
  await h.idle();
  h.close(1);
  await h.idle();
  assert.equal(h.storage.local.closedTabs?.[0]?.url, page(1).url);
});

test('创建后未完成加载的标签也能记录已提交页面', async () => {
  const h = createHarness();
  await h.idle();
  h.create(page(1));
  h.close(1);
  await h.idle();
  assert.equal(h.storage.local.closedTabs?.[0]?.url, page(1).url);
});

test('未提交导航保留最后已提交的页面 URL', async () => {
  const h = createHarness();
  await track(h, page(1));
  h.update(1, { status: 'loading' }, { ...page(1), pendingUrl: 'https://example.com/pending' });
  h.close(1);
  await h.idle();
  assert.equal(h.storage.local.closedTabs[0].url, page(1).url);
});

test('转到内部页面时清理之前的网页快照', async () => {
  const h = createHarness();
  await track(h, page(1));
  h.update(1, { url: 'chrome://settings/' }, page(1, '设置', 'chrome://settings/'));
  h.close(1);
  await h.idle();
  assert.deepEqual(h.storage.local.closedTabs || [], []);
  assert.equal(Object.values(h.storage.session).some(value => value?.url === page(1).url), false);
});

test('worker 重启后立即关闭仍可从会话快照恢复记录', async () => {
  const storage = createStorage();
  const first = createHarness({ storage });
  await track(first, page(1, '重启前标题'));
  const restarted = createHarness({ storage, tabs: [] });
  restarted.setTime(2000);
  restarted.close(1);
  await restarted.idle();
  assert.equal(storage.local.closedTabs?.[0]?.title, '重启前标题');
  assert.equal(storage.local.closedTabs?.[0]?.closedAt, 2000);
  assert.equal(Object.values(storage.session).some(value => value?.url === page(1).url), false);
});

test('启动查询延迟期间的新更新不会被查询的旧快照覆盖', async () => {
  const h = createHarness({ tabs: [page(1, '旧标题')], deferQuery: true });
  h.update(1, { title: '新标题' }, page(1, '新标题'));
  h.releaseQuery();
  await h.idle();
  h.close(1);
  await h.idle();
  assert.equal(h.storage.local.closedTabs?.[0]?.title, '新标题');
});

test('启动查询完成前关闭标签，保留事件时间且不复活快照', async () => {
  const h = createHarness({ tabs: [page(1)], deferQuery: true });
  h.setTime(2000);
  h.close(1);
  h.setTime(9000);
  h.releaseQuery();
  await h.idle();
  assert.equal(h.storage.local.closedTabs?.[0]?.closedAt, 2000);
  assert.equal(Object.values(h.storage.session).some(value => value?.url === page(1).url), false);
});

test('连续关闭多个标签不会互相覆盖，并按关闭时间倒序', async () => {
  const h = createHarness();
  await track(h, page(1), page(2), page(3));
  for (const id of [1, 2, 3]) {
    h.setTime(id * 1000);
    h.close(id);
  }
  await h.idle();
  assert.deepEqual(h.storage.local.closedTabs.map(tab => tab.closedAt), [3000, 2000, 1000]);
});

test('同一毫秒关闭的标签按照事件倒序排列', async () => {
  const h = createHarness({ local: { closedTabs: [record('已有', 1000)] } });
  await track(h, page(1), page(2));
  h.setTime(1000);
  h.close(1);
  h.close(2);
  await h.idle();
  assert.deepEqual(h.storage.local.closedTabs.map(tab => tab.url), [page(2).url, page(1).url, 'https://example.com/已有']);
});

test('重复 URL 更新最后标题和关闭时间，同时保留原记录 id', async () => {
  const existing = record('原始记录', 100, page(1).url);
  const h = createHarness({ local: { closedTabs: [existing] } });
  await track(h, page(1, '最后标题'));
  h.setTime(3000);
  h.close(1);
  await h.idle();
  assert.equal(h.storage.local.closedTabs.length, 1);
  assert.equal(h.storage.local.closedTabs[0].id, '原始记录');
  assert.equal(h.storage.local.closedTabs[0].title, '最后标题');
  assert.equal(h.storage.local.closedTabs[0].closedAt, 3000);
});

test('读取历史按关闭时间降序，时间相同保持原顺序', async () => {
  const h = createHarness({ local: { closedTabs: [record('旧', 1), record('新一', 3), record('新二', 3)] } });
  await h.idle();
  const result = await h.request({ action: 'getClosedTabs' });
  assert.deepEqual(result.closedTabs.map(tab => tab.id), ['新一', '新二', '旧']);
});

test('读取历史等待此前的关闭保存完成', async () => {
  const h = createHarness();
  await track(h, page(1));
  h.close(1);
  const result = await h.request({ action: 'getClosedTabs' });
  assert.equal(result.closedTabs.length, 1);
});

test('读取已有历史不等待启动标签查询完成', async () => {
  const h = createHarness({ local: { closedTabs: [record('已有', 1)] }, deferQuery: true });
  try {
    const result = await h.request({ action: 'getClosedTabs' });
    assert.equal(result.closedTabs[0].id, '已有');
  } finally {
    h.releaseQuery();
    await h.idle();
  }
});

test('读取已有历史不等待会话快照读取完成', async () => {
  const h = createHarness({ local: { closedTabs: [record('已有', 1)] } });
  const release = h.delayNext('session', 'get');
  try {
    const result = await h.request({ action: 'getClosedTabs' });
    assert.equal(result.closedTabs[0].id, '已有');
  } finally {
    release();
    await h.idle();
  }
});

test('保存前先排序再按配置保留最新记录', async () => {
  const h = createHarness({
    local: { closedTabs: [record('最旧', 1), record('最新', 5000), ...Array.from({ length: 8 }, (_, i) => record(`旧${i}`, i + 2))] },
    sync: { config: { maxHistorySize: 10 } }
  });
  await track(h, page(1));
  h.setTime(3000);
  h.close(1);
  await h.idle();
  assert.deepEqual(h.storage.local.closedTabs.slice(0, 2).map(tab => tab.closedAt), [5000, 3000]);
  assert.equal(h.storage.local.closedTabs.length, 10);
});

test('导入乱序记录时去重同批次与已有记录，并保留最新记录', async () => {
  const existing = record('已有', 40);
  const h = createHarness({ local: { closedTabs: [existing, ...Array.from({ length: 7 }, (_, i) => record(`旧${i}`, i + 2))] }, sync: { config: { maxHistorySize: 10 } } });
  await h.idle();
  const duplicate = record('重复', 20);
  const result = await h.request({ action: 'importClosedTabs', tabs: [record('旧', 1), duplicate, duplicate, existing, record('新', 50)] });
  assert.equal(result.success, true);
  assert.equal(result.importedCount, 3);
  assert.deepEqual(h.storage.local.closedTabs.slice(0, 3).map(tab => tab.closedAt), [50, 40, 20]);
  assert.equal(h.storage.local.closedTabs.length, 10);
});

test('导入同 URL 的多个关闭记录后再次关闭，只保留最新信息及原 id', async () => {
  const h = createHarness();
  await h.idle();
  await h.request({ action: 'importClosedTabs', tabs: [record('较旧记录', 10, page(1).url), record('原记录', 20, page(1).url)] });
  await track(h, page(1, '最后标题'));
  h.setTime(30);
  h.close(1);
  await h.idle();
  assert.equal(h.storage.local.closedTabs.length, 1);
  assert.equal(h.storage.local.closedTabs[0].id, '原记录');
  assert.equal(h.storage.local.closedTabs[0].title, '最后标题');
  assert.equal(h.storage.local.closedTabs[0].closedAt, 30);
});

test('设置裁剪从当前配置读取限制并保留最新记录', async () => {
  const h = createHarness({
    local: { closedTabs: [record('旧', 1), record('新', 30), record('中', 20), ...Array.from({ length: 8 }, (_, i) => record(`旧${i}`, i + 2))] },
    sync: { config: { maxHistorySize: 10 } }
  });
  await h.idle();
  const result = await h.request({ action: 'trimClosedTabs' });
  assert.equal(result.success, true);
  assert.deepEqual(h.storage.local.closedTabs.slice(0, 2).map(tab => tab.id), ['新', '中']);
  assert.equal(h.storage.local.closedTabs.length, 10);
  assert.equal(h.storage.local.closedTabs.some(tab => tab.id === '旧'), false);
});

test('关闭与删除串行处理，不丢失新关闭记录也不恢复已删除记录', async () => {
  const h = createHarness({ local: { closedTabs: [record('删除', 1)] } });
  await track(h, page(1));
  h.close(1);
  const result = await h.request({ action: 'removeClosedTab', tabId: '删除' });
  await h.idle();
  assert.equal(result.success, true);
  assert.equal(h.storage.local.closedTabs.length, 1);
  assert.equal(h.storage.local.closedTabs[0].url, page(1).url);
});

test('关闭之后清空历史，不会被尚未完成的保存重新写回', async () => {
  const h = createHarness();
  await track(h, page(1));
  h.close(1);
  const result = await h.request({ action: 'clearAllClosedTabs' });
  await h.idle();
  assert.equal(result.success, true);
  assert.deepEqual(h.storage.local.closedTabs, []);
});

test('关闭与导入同时发生时两种记录都保留', async () => {
  const h = createHarness();
  await track(h, page(1));
  h.setTime(20);
  h.close(1);
  const result = await h.request({ action: 'importClosedTabs', tabs: [record('导入', 10)] });
  await h.idle();
  assert.equal(result.success, true);
  assert.deepEqual(h.storage.local.closedTabs.map(tab => tab.closedAt), [20, 10]);
});

test('关闭与裁剪同时发生，保留配置数量内最新的记录', async () => {
  const h = createHarness({
    local: { closedTabs: [record('旧', 1), record('中', 20), ...Array.from({ length: 8 }, (_, i) => record(`旧${i}`, i + 2))] },
    sync: { config: { maxHistorySize: 10 } }
  });
  await track(h, page(1));
  h.setTime(30);
  h.close(1);
  const result = await h.request({ action: 'trimClosedTabs' });
  await h.idle();
  assert.equal(result.success, true);
  assert.deepEqual(h.storage.local.closedTabs.slice(0, 2).map(tab => tab.closedAt), [30, 20]);
  assert.equal(h.storage.local.closedTabs.length, 10);
});

test('写入活动快照失败仍然记录最后的标题与 URL', async () => {
  const h = createHarness();
  await track(h, page(1, '旧标题'));
  h.failNext('session', 'set');
  h.update(1, { title: '最后标题' }, page(1, '最后标题'));
  h.close(1);
  await h.idle();
  assert.equal(h.storage.local.closedTabs?.[0]?.title, '最后标题');
  assert.equal(h.storage.local.closedTabs?.[0]?.url, page(1).url);
});

test('删除活动快照失败不会阻止写入关闭历史', async () => {
  const h = createHarness();
  await track(h, page(1));
  h.failNext('session', 'remove');
  h.close(1);
  await h.idle();
  assert.equal(h.storage.local.closedTabs?.[0]?.url, page(1).url);
});

test('初始化清理失败时等待尚未完成的快照写入，避免重启恢复旧标题', async () => {
  const storage = createStorage();
  const previous = createHarness({ storage });
  await track(previous, page(99));

  const h = createHarness({ storage, tabs: [page(1, '旧标题')] });
  const release = h.delayNext('session', 'set');
  h.failNext('session', 'remove');
  await h.idle();
  h.update(1, { title: '最新标题' }, page(1, '最新标题'));
  await h.idle();
  release();
  await h.idle();

  const restarted = createHarness({ storage });
  restarted.close(1);
  await restarted.idle();
  assert.equal(storage.local.closedTabs?.[0]?.title, '最新标题');
});

test('导入保存失败返回失败，后续导入仍可恢复', async () => {
  const h = createHarness();
  await h.idle();
  h.failNext('local', 'set');
  const failure = await h.request({ action: 'importClosedTabs', tabs: [record('失败', 1)] });
  assert.equal(failure.success, false);
  const success = await h.request({ action: 'importClosedTabs', tabs: [record('成功', 2)] });
  assert.equal(success.success, true);
  assert.deepEqual(h.storage.local.closedTabs.map(tab => tab.id), ['成功']);
});

test('保存失败后队列仍能处理后续关闭记录', async () => {
  const h = createHarness();
  await track(h, page(1), page(2));
  h.failNext('local', 'set');
  h.close(1);
  await h.idle();
  h.close(2);
  await h.idle();
  assert.equal(h.storage.local.closedTabs?.length, 1);
  assert.equal(h.storage.local.closedTabs?.[0]?.url, page(2).url);
});


test('导入仅保留有效字段类型，并归一化图标和丢弃未知字段', async () => {
  const h = createHarness();
  await h.idle();
  const valid = { ...record('有效', 1), favIconUrl: 123, unknown: '不存储' };
  const invalid = [null, [], { ...record('数字标题', 2), title: 123 },
    { ...record('数字URL', 3), url: 456 }, { ...record('数字ID', 4), id: 123 },
    { ...record('文本时间', 5), closedAt: '昨天' }, { ...record('无限时间', 6), closedAt: Infinity }];
  const result = await h.request({ action: 'importClosedTabs', tabs: [valid, ...invalid] });
  assert.equal(result.success, true);
  assert.equal(result.importedCount, 1);
  assert.equal(result.validCount, 1);
  assert.deepEqual(h.storage.local.closedTabs, [record('有效', 1)]);
});

test('导入允许有限的零时间，并拒绝非数组输入', async () => {
  const h = createHarness();
  await h.idle();
  assert.equal((await h.request({ action: 'importClosedTabs', tabs: {} })).success, false);
  assert.equal((await h.request({ action: 'importClosedTabs', tabs: [record('零', 0)] })).importedCount, 1);
});

test('导入为与现有记录及同批记录冲突的 ID 生成唯一值', async () => {
  const h = createHarness({ local: { closedTabs: [record('相同', 1, 'https://a.test')] } });
  await h.idle();
  await h.request({ action: 'importClosedTabs', tabs: [
    record('相同', 2, 'https://b.test'), record('相同', 3, 'https://c.test')
  ] });
  const ids = h.storage.local.closedTabs.map(tab => tab.id);
  assert.equal(new Set(ids).size, 3);
  await h.request({ action: 'removeClosedTab', tabId: ids[0] });
  assert.equal(h.storage.local.closedTabs.length, 2);
});

test('内部页面无关更新不调用会话存储，相关 URL 更新仍清理快照', async () => {
  const h = createHarness({ tabs: [page(1, '设置', 'chrome://settings/')] });
  await h.idle();
  h.calls.length = 0;
  for (let i = 0; i < 100; i++) {
    h.update(1, { audible: Boolean(i % 2) }, page(1, '设置', 'chrome://settings/'));
  }
  await h.idle();
  assert.equal(h.calls.filter(call => call.area === 'session').length, 0);
  h.update(1, { url: page(1).url }, page(1));
  await h.idle();
  assert.equal(h.calls.filter(call => call.area === 'session' && call.method === 'set').length, 1);
});

test('无效历史上限拒绝裁剪和保存，不破坏现有记录', async () => {
  for (const limit of [NaN, null, 0, -1, 9, 5001, 10.5, '20']) {
    const original = [record('已有', 1)];
    const h = createHarness({ local: { closedTabs: original }, sync: { config: { maxHistorySize: limit } } });
    await h.idle();
    assert.equal((await h.request({ action: 'trimClosedTabs' })).success, false, String(limit));
    assert.equal((await h.request({ action: 'importClosedTabs', tabs: [record('导入', 2)] })).success, false);
    assert.deepEqual(h.storage.local.closedTabs, original);
    assert.equal(h.calls.filter(call => call.area === 'local' && call.method === 'set').length, 0);
  }
});

test('缺失历史上限采用默认值，删除不存在记录和重复导入不写历史', async () => {
  const existing = record('已有', 1);
  const h = createHarness({ local: { closedTabs: [existing] }, sync: { config: {} } });
  await h.idle();
  await h.request({ action: 'removeClosedTab', tabId: '不存在' });
  const repeated = await h.request({ action: 'importClosedTabs', tabs: [existing] });
  assert.equal(repeated.validCount, 1);
  assert.equal(repeated.importedCount, 0);
  await h.request({ action: 'trimClosedTabs' });
  assert.equal(h.calls.filter(call => call.area === 'local' && call.method === 'set').length, 0);
  assert.equal((await h.request({ action: 'importClosedTabs', tabs: [record('新', 2)] })).success, true);
  assert.equal(h.storage.local.closedTabs.length, 2);
});

test('快照写入失败后相同相关更新会重试，重启立即关闭仍保留最新标题', async () => {
  const storage = createStorage();
  const h = createHarness({ storage });
  await track(h, page(1, '旧标题'));
  h.failNext('session', 'set');
  h.update(1, { title: '新标题' }, page(1, '新标题'));
  await h.idle();
  h.update(1, { title: '新标题' }, page(1, '新标题'));
  await h.idle();
  const restarted = createHarness({ storage });
  restarted.close(1);
  await restarted.idle();
  assert.equal(storage.local.closedTabs[0].title, '新标题');
});

test('空导入和全非法导入不整理或改写已有历史', async () => {
  const original = [record('旧', 1), record('新', 2)];
  const h = createHarness({ local: { closedTabs: original } });
  await h.idle();
  for (const tabs of [[], [{ title: 123 }]]) {
    const result = await h.request({ action: 'importClosedTabs', tabs });
    assert.equal(result.success, true);
    assert.equal(result.validCount, 0);
    assert.equal(result.importedCount, 0);
  }
  assert.deepEqual(h.storage.local.closedTabs, original);
  assert.equal(h.calls.filter(call => call.area === 'local' && call.method === 'set').length, 0);
});

test('已有同 URL 历史乱序时仍保留最新原 ID，并维持未来时间记录顺序', async () => {
  const h = createHarness({ local: { closedTabs: [
    record('旧ID', 1, page(1).url), record('未来', 5000), record('新ID', 5, page(1).url)
  ] } });
  await track(h, page(1));
  h.setTime(1000);
  h.close(1);
  await h.idle();
  assert.deepEqual(h.storage.local.closedTabs.map(tab => tab.id), ['未来', '新ID']);
});

test('启动快照写入失败后相同标题更新也会重试持久化', async () => {
  const h = createHarness({ tabs: [page(1)] });
  h.failNext('session', 'set');
  await h.idle();
  h.update(1, { title: page(1).title }, page(1));
  await h.idle();
  assert.equal(h.storage.session.activeTab_1.title, page(1).title);
  assert.equal(h.calls.filter(call => call.area === 'session' && call.method === 'set').length, 2);
});

test('恢复由后台按当前 ID 创建标签，再删除历史记录', async () => {
  const current = record('恢复', 1, 'https://current.test');
  const h = createHarness({ local: { closedTabs: [current] } });
  await h.idle();
  const result = await h.request({ action: 'restoreClosedTab', tabId: current.id, url: 'https://stale.test' });
  assert.deepEqual(result, { success: true });
  assert.deepEqual(h.calls.filter(call => call.area === 'tabs' && call.method === 'create').map(call => call.argument), [{ url: current.url }]);
  assert.deepEqual(h.storage.local.closedTabs, []);
});

test('恢复创建失败保留历史，并区分未创建状态', async () => {
  const current = record('恢复', 1);
  const h = createHarness({ local: { closedTabs: [current] } });
  await h.idle();
  h.failNext('tabs', 'create');
  assert.deepEqual(await h.request({ action: 'restoreClosedTab', tabId: current.id }), { success: false, created: false });
  assert.deepEqual(h.storage.local.closedTabs, [current]);
  assert.equal(h.calls.filter(call => call.area === 'local' && call.method === 'set').length, 0);
});

test('恢复已创建但删除存储失败时保留记录，并返回已创建状态', async () => {
  const current = record('恢复', 1);
  const h = createHarness({ local: { closedTabs: [current] } });
  await h.idle();
  h.failNext('local', 'set');
  assert.deepEqual(await h.request({ action: 'restoreClosedTab', tabId: current.id }), { success: false, created: true });
  assert.deepEqual(h.storage.local.closedTabs, [current]);
  assert.equal(h.calls.filter(call => call.area === 'tabs' && call.method === 'create').length, 1);
});

test('读取恢复记录失败时不创建标签，并返回未创建状态', async () => {
  const h = createHarness();
  await h.idle();
  h.failNext('local', 'get');
  assert.deepEqual(await h.request({ action: 'restoreClosedTab', tabId: '恢复' }), { success: false, created: false });
  assert.equal(h.calls.filter(call => call.area === 'tabs' && call.method === 'create').length, 0);
});

test('并发恢复同一记录只创建一次，已经删除的记录也不会重新打开', async () => {
  const current = record('恢复', 1);
  const h = createHarness({ local: { closedTabs: [current] } });
  await h.idle();
  const request = { action: 'restoreClosedTab', tabId: current.id };
  assert.deepEqual(await Promise.all([h.request(request), h.request(request)]), [{ success: true }, { success: true }]);
  assert.deepEqual(await h.request(request), { success: true });
  assert.equal(h.calls.filter(call => call.area === 'tabs' && call.method === 'create').length, 1);
});

test('恢复创建期间发生关闭和导入，串行写入保留两种新历史', async () => {
  const h = createHarness({ local: { closedTabs: [record('恢复', 1)] } });
  await track(h, page(1));
  const release = h.delayNext('tabs', 'create');
  const restoring = h.request({ action: 'restoreClosedTab', tabId: '恢复' });
  await h.idle();
  h.setTime(30);
  h.close(1);
  const importing = h.request({ action: 'importClosedTabs', tabs: [record('导入', 20)] });
  release();
  assert.deepEqual(await restoring, { success: true });
  assert.equal((await importing).success, true);
  await h.idle();
  assert.deepEqual(h.storage.local.closedTabs.map(tab => tab.url), [page(1).url, 'https://example.com/导入']);
});
