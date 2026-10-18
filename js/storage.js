(() => {
  'use strict';
  const MAP_ID = 'dolmenwood-player-map';
  const STORAGE_KEY = `${MAP_ID}:local-campaign:v1`;
  const emptyDataset = () => ({ version: 1, mapId: MAP_ID, records: {} });
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function validateDataset(value) {
    if (!isObject(value) || value.version !== 1 || value.mapId !== MAP_ID || !isObject(value.records)) {
      throw new Error('Expected a version 1 Dolmenwood map backup.');
    }
    const records = {};
    for (const [id, record] of Object.entries(value.records)) {
      if (!window.DolmenwoodGrid.byId.has(id)) throw new Error(`Unknown hex coordinate: ${id}.`);
      if (!isObject(record) || typeof record.notes !== 'string' || typeof record.visited !== 'boolean' ||
          typeof record.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.updatedAt) ||
          !Number.isFinite(Date.parse(record.updatedAt)) || new Date(record.updatedAt).toISOString() !== record.updatedAt) {
        throw new Error(`Invalid notes, visited state, or timestamp for hex ${id}.`);
      }
      records[id] = { notes: record.notes, visited: record.visited, updatedAt: record.updatedAt };
    }
    return { version: 1, mapId: MAP_ID, records };
  }
  const clone = value => JSON.parse(JSON.stringify(value));
  // Async adapter contract. The local write itself happens synchronously before its
  // promise resolves, so a pagehide flush can persist the latest keystroke.
  class LocalStorageAdapter {
    async read() { return window.localStorage.getItem(STORAGE_KEY); }
    async write(dataset) { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dataset)); }
    writeOnExit(dataset) { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dataset)); }
  }
  class CampaignStore {
    constructor(adapter = new LocalStorageAdapter(), onChange = () => {}) {
      this.adapter = adapter;
      this.onChange = onChange;
      this.data = emptyDataset();
      this.revision = 0;
      this.savedRevision = 0;
      this.inFlight = null;
      this.timer = null;
      this.raw = null;
      this.locked = false;
      this.state = 'loading';
    }
    notify(state) { this.state = state; this.onChange(this); }
    async load() {
      let raw;
      try { raw = await this.adapter.read(); }
      catch (error) { this.error = error; this.notify('error'); return; }
      if (raw !== null) {
        try { this.data = validateDataset(JSON.parse(raw)); }
        catch (error) {
          this.raw = raw; this.locked = true; this.error = error; this.notify('corrupt'); return;
        }
      }
      this.notify('saved');
    }
    update(id, notes, visited, immediate = false) {
      if (this.locked || !window.DolmenwoodGrid.byId.has(id)) return;
      this.data.records[id] = { notes, visited, updatedAt: new Date().toISOString() };
      this.revision += 1;
      clearTimeout(this.timer);
      this.notify('pending');
      if (immediate) return this.flush();
      this.timer = setTimeout(() => this.flush(), 400);
    }
    flush() {
      clearTimeout(this.timer);
      if (this.locked) return Promise.resolve(false);
      // Serialize adapters that may eventually write over a network. Each write
      // owns an immutable snapshot; a later hex selection cannot redirect it.
      if (this.inFlight) return this.inFlight.then(ok => ok ? this.flush() : false);
      if (this.revision === this.savedRevision) return Promise.resolve(true);
      const revision = this.revision;
      const snapshot = clone(this.data);
      this.notify('saving');
      let write;
      try { write = this.adapter.write(snapshot); }
      catch (error) { write = Promise.reject(error); }
      this.inFlight = Promise.resolve(write).then(() => {
        this.savedRevision = Math.max(this.savedRevision, revision);
        this.error = null;
        this.notify(this.revision === this.savedRevision ? 'saved' : 'pending');
        return true;
      }, error => {
        this.error = error;
        this.notify('error');
        return false;
      }).finally(() => { this.inFlight = null; });
      return this.inFlight;
    }
    snapshot() { return clone(this.data); }
    flushOnExit() {
      clearTimeout(this.timer);
      if (!this.hasUnsavedChanges) return;
      if (!this.adapter.writeOnExit) { this.flush(); return; }
      // Do not wait for a promise/microtask while the document is being discarded.
      try {
        this.adapter.writeOnExit(this.snapshot());
        this.savedRevision = this.revision;
        this.error = null;
        this.notify('saved');
      } catch (error) { this.error = error; this.notify('error'); }
    }
    async replace(dataset) {
      const validated = validateDataset(dataset);
      await this.flush();
      this.data = validated;
      this.locked = false;
      this.raw = null;
      this.revision += 1;
      return this.flush();
    }
    get hasUnsavedChanges() { return !this.locked && this.revision !== this.savedRevision; }
  }
  window.DolmenwoodStorage = Object.freeze({ MAP_ID, STORAGE_KEY, emptyDataset, validateDataset, LocalStorageAdapter, CampaignStore });
})();
