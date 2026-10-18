// No packages required: node --test dolmenwood-player-map/tests/data.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function modules(localStorage) {
  const window = { localStorage };
  const context = vm.createContext({ window, setTimeout, clearTimeout });
  for (const name of ['grid', 'storage']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8'), context);
  return { grid: window.DolmenwoodGrid, storage: window.DolmenwoodStorage };
}
function memoryAdapter(initial = null) {
  return { raw: initial, writes: [], async read() { return this.raw; }, async write(data) {
    this.writes.push(JSON.parse(JSON.stringify(data))); this.raw = JSON.stringify(data);
  } };
}

test('all 200 printed hexes fit the image, with no margin hexes', () => {
  const { grid } = modules();
  assert.equal(grid.hexes.length, 200);
  assert.equal(grid.byId.size, 200);
  for (const id of ['0101', '0111', '0312', '1012', '1312', '1410', '1509', '1608', '1707', '1806', '1906']) assert.ok(grid.byId.has(id), id);
  for (const id of ['0001', '0112', '1411', '1510', '1609', '1708', '1807', '1907', '2001']) assert.equal(grid.byId.has(id), false, id);
  for (const hex of grid.hexes) for (const point of hex.points.split(' ')) {
    const [x, y] = point.split(',').map(Number);
    assert.ok(x >= 0 && x <= grid.width && y >= 0 && y <= grid.height);
  }
  assert.equal(grid.neighbor('0101', 'ArrowDown').id, '0102');
  assert.equal(grid.neighbor('0101', 'ArrowRight').id, '0201');
  assert.equal(grid.neighbor('0101', 'ArrowLeft'), null);
  assert.equal(grid.neighbor('1906', 'ArrowRight'), null);
});

test('debounced autosave, rapid hex switching, empty and multiline notes round trip', async () => {
  const { storage } = modules();
  const adapter = memoryAdapter();
  const store = new storage.CampaignStore(adapter);
  await store.load();
  store.update('0101', '<script>plain text</script>\nSecond line', true);
  assert.equal(adapter.writes.length, 0);
  await store.flush();
  store.update('0201', 'Different hex', false);
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(adapter.writes.length, 2);
  const loaded = new storage.CampaignStore(adapter);
  await loaded.load();
  assert.equal(loaded.data.records['0101'].notes, '<script>plain text</script>\nSecond line');
  assert.equal(loaded.data.records['0201'].notes, 'Different hex');
  await loaded.update('0101', '', false, true);
  assert.equal(JSON.parse(adapter.raw).records['0101'].notes, '');
  assert.equal(JSON.stringify(storage.validateDataset(loaded.snapshot())), JSON.stringify(loaded.snapshot()));
});

test('async writes are serialized and retain their original snapshot', async () => {
  const { storage } = modules();
  const writes = [];
  const resolvers = [];
  const adapter = { async read() { return null; }, write(data) { writes.push(data); return new Promise(resolve => resolvers.push(resolve)); } };
  const store = new storage.CampaignStore(adapter);
  await store.load();
  store.update('0101', 'A', false);
  const first = store.flush();
  store.update('0201', 'B', true);
  const second = store.flush();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].records['0201'], undefined);
  resolvers.shift()();
  await first;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(writes.length, 2);
  assert.equal(writes[1].records['0201'].notes, 'B');
  resolvers.shift()();
  await second;
  assert.equal(store.state, 'saved');
});

test('failed storage keeps edits exportable and retries successfully', async () => {
  const { storage } = modules();
  const adapter = memoryAdapter();
  const originalWrite = adapter.write;
  adapter.write = async () => { throw new Error('Quota exceeded'); };
  const store = new storage.CampaignStore(adapter);
  await store.load();
  await store.update('0101', 'Keep me', true, true);
  assert.equal(store.state, 'error');
  assert.equal(store.snapshot().records['0101'].notes, 'Keep me');
  assert.equal(store.hasUnsavedChanges, true);
  adapter.write = originalWrite;
  await store.flush();
  assert.equal(store.state, 'saved');
});

test('corrupt storage is preserved until explicit replacement', async () => {
  const { storage } = modules();
  for (const raw of ['{broken', 'null', '{"version":2}', '']) {
    const adapter = memoryAdapter(raw);
    const store = new storage.CampaignStore(adapter);
    await store.load();
    assert.equal(store.locked, true);
    assert.equal(store.raw, raw);
    store.update('0101', 'Do not write', false);
    await store.flush();
    assert.equal(adapter.raw, raw);
    assert.equal(adapter.writes.length, 0);
    await store.replace(storage.emptyDataset());
    assert.equal(store.locked, false);
    assert.equal(JSON.parse(adapter.raw).version, 1);
  }
});

test('imports reject invalid schema, coordinates, fields and timestamps', () => {
  const { storage } = modules();
  const valid = { notes: 'hello', visited: true, updatedAt: '2026-10-17T12:00:00.000Z' };
  for (const value of [null, [], {}, { version: 2, mapId: storage.MAP_ID, records: {} },
    { version: 1, mapId: 'another-map', records: {} },
    { version: 1, mapId: storage.MAP_ID, records: [] }]) assert.throws(() => storage.validateDataset(value));
  for (const [id, record] of [['1907', valid], ['__proto__', valid], ['101', valid],
    ['0101', { ...valid, visited: 'true' }], ['0101', { ...valid, notes: {} }],
    ['0101', { ...valid, updatedAt: '2026-02-30T12:00:00.000Z' }]]) {
    assert.throws(() => storage.validateDataset({ version: 1, mapId: storage.MAP_ID, records: { [id]: record } }));
  }
});

test('page exit writes pending edits synchronously, even with an unresolved write promise', async () => {
  let raw = null;
  const { storage } = modules({ getItem: () => raw, setItem: (key, value) => { raw = value; } });
  const store = new storage.CampaignStore();
  await store.load();
  store.update('0101', 'First', true, true);
  store.update('0201', 'Last keystroke', false);
  store.flushOnExit();
  assert.equal(JSON.parse(raw).records['0201'].notes, 'Last keystroke');
  await store.inFlight;
  assert.equal(store.hasUnsavedChanges, false);
  assert.equal(store.state, 'saved');
});
