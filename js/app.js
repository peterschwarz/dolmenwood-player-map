(() => {
  'use strict';
  const grid = window.DolmenwoodGrid;
  const storage = window.DolmenwoodStorage;
  const $ = id => document.getElementById(id);
  const viewport = $('map-viewport');
  const stage = $('map-stage');
  const overlay = $('hex-overlay');
  const polygons = new Map();
  let selectedId = '0101';
  let zoom = 1;
  let scale = 1;
  let ready = false;
  let busy = false;

  function showMessage(message) {
    $('message').textContent = message;
    $('message').hidden = !message;
  }
  function renderState(store) {
    const descriptions = {
      loading: 'Loading saved map…', pending: 'Saving…', saving: 'Saving…',
      saved: 'All changes saved in this browser',
      error: 'Could not save. Edits remain here; export a backup.',
      corrupt: 'Saved data needs recovery. Editing is paused.',
    };
    $('save-status').textContent = descriptions[store.state];
    $('save-status').dataset.state = store.state;
    $('retry-save').hidden = store.state !== 'error';
    $('recovery').hidden = !store.locked;
    $('editor').disabled = !ready || store.locked || busy;
    $('export').disabled = !ready || store.locked || busy;
    $('import').disabled = !ready || busy;
    $('reset-data').disabled = busy;
    let visited = 0;
    for (const [id, polygon] of polygons) {
      const record = store.data.records[id];
      const isVisited = record?.visited === true;
      if (isVisited) visited += 1;
      polygon.classList.toggle('visited', isVisited);
      polygon.classList.toggle('selected', id === selectedId);
      polygon.setAttribute('aria-pressed', String(id === selectedId));
      polygon.setAttribute('aria-label', `Hex ${id}${isVisited ? ', visited' : ', unvisited'}`);
      polygon.setAttribute('tabindex', id === selectedId ? '0' : '-1');
    }
    $('visited-count').textContent = `${visited} / ${grid.hexes.length}`;
    $('record-count').textContent = Object.keys(store.data.records).length;
  }
  const store = new storage.CampaignStore(undefined, renderState);

  function revealHex(id) {
    const hex = grid.byId.get(id);
    const x = stage.offsetLeft + hex.x * scale;
    const y = stage.offsetTop + hex.y * scale;
    const insetX = Math.min(160 * scale, viewport.clientWidth / 3);
    const insetY = Math.min(140 * scale, viewport.clientHeight / 3);
    if (x < viewport.scrollLeft + insetX || x > viewport.scrollLeft + viewport.clientWidth - insetX ||
        y < viewport.scrollTop + insetY || y > viewport.scrollTop + viewport.clientHeight - insetY) {
      viewport.scrollTo({ left: x - viewport.clientWidth / 2, top: y - viewport.clientHeight / 2 });
    }
  }
  function selectHex(id, { focus = false, reveal = false } = {}) {
    if (!grid.byId.has(id) || busy) return;
    if (store.hasUnsavedChanges) store.flush();
    selectedId = id;
    $('selected-id').textContent = id;
    $('hex-select').value = id;
    const record = store.data.records[id];
    $('notes').value = record?.notes ?? '';
    $('visited').checked = record?.visited ?? false;
    $('notes').setAttribute('aria-label', `Notes for hex ${id}`);
    renderState(store);
    // Paint the selected border above adjacent polygons.
    overlay.append(polygons.get(id));
    if (reveal) revealHex(id);
    if (focus) polygons.get(id).focus({ preventScroll: true });
  }

  for (const hex of grid.hexes) {
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', hex.points);
    polygon.setAttribute('class', 'hex');
    polygon.setAttribute('role', 'button');
    polygon.dataset.hex = hex.id;
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `Hex ${hex.id}`;
    polygon.append(title);
    overlay.append(polygon);
    polygons.set(hex.id, polygon);
    const option = document.createElement('option');
    option.value = hex.id;
    option.textContent = `Hex ${hex.id}`;
    $('hex-select').append(option);
  }
  overlay.addEventListener('click', event => {
    const polygon = event.target.closest('[data-hex]');
    if (polygon) selectHex(polygon.dataset.hex, { focus: true });
  });
  overlay.addEventListener('keydown', event => {
    const polygon = event.target.closest('[data-hex]');
    if (!polygon) return;
    const id = polygon.dataset.hex;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectHex(id, { focus: true });
    } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? grid.hexes[0] : event.key === 'End' ? grid.hexes.at(-1) : grid.neighbor(id, event.key);
      if (next) selectHex(next.id, { focus: true, reveal: true });
    }
  });
  $('hex-select').addEventListener('change', event => selectHex(event.target.value, { reveal: true }));
  $('notes').addEventListener('input', () => store.update(selectedId, $('notes').value, $('visited').checked));
  $('visited').addEventListener('change', () => store.update(selectedId, $('notes').value, $('visited').checked, true));
  $('retry-save').addEventListener('click', async () => {
    if (store.hasUnsavedChanges) await store.flush();
    else { await store.load(); selectHex(selectedId); }
  });

  function layoutMap(nextZoom = zoom, reset = false) {
    const centerX = (viewport.scrollLeft + viewport.clientWidth / 2 - stage.offsetLeft) / scale;
    const centerY = (viewport.scrollTop + viewport.clientHeight / 2 - stage.offsetTop) / scale;
    zoom = Math.max(1, Math.min(8, nextZoom));
    // Reserve scrollbar space so resizing never oscillates at the fit boundary.
    const fit = Math.min((viewport.clientWidth - 2) / grid.width, (viewport.clientHeight - 2) / grid.height);
    scale = fit * zoom;
    stage.style.width = `${grid.width * scale}px`;
    stage.style.height = `${grid.height * scale}px`;
    stage.style.marginTop = `${Math.max(0, (viewport.clientHeight - grid.height * scale) / 2)}px`;
    $('zoom-level').textContent = `${Math.round(zoom * 100)}%`;
    $('zoom-in').disabled = zoom >= 8;
    $('zoom-out').disabled = zoom <= 1;
    viewport.scrollTo({ left: reset ? 0 : centerX * scale + stage.offsetLeft - viewport.clientWidth / 2,
      top: reset ? 0 : centerY * scale + stage.offsetTop - viewport.clientHeight / 2 });
  }
  $('zoom-in').addEventListener('click', () => layoutMap(zoom * 1.4));
  $('zoom-out').addEventListener('click', () => layoutMap(zoom / 1.4));
  $('zoom-fit').addEventListener('click', () => layoutMap(1, true));
  new ResizeObserver(() => layoutMap()).observe(viewport);

  function download(text, filename, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  $('export').addEventListener('click', () => {
    store.flush();
    download(JSON.stringify(store.snapshot(), null, 2), `dolmenwood-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    showMessage('Backup exported, including your latest edits. Keep it somewhere safe.');
  });
  $('import').addEventListener('click', () => {
    store.flush();
    $('import-file').click();
  });
  $('import-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    busy = true;
    renderState(store);
    try {
      await store.flush();
      const incoming = storage.validateDataset(JSON.parse(await file.text()));
      const count = Object.keys(incoming.records).length;
      if (!window.confirm(`Replace the current campaign with ${count} recorded hexes from this backup? Existing notes and visited marks will be replaced. Export a backup first if you want to keep them.`)) {
        showMessage('Import cancelled. Your current campaign is unchanged.');
        return;
      }
      const saved = await store.replace(incoming);
      showMessage(saved ? `Backup imported: ${count} recorded hexes.` : 'Backup imported into memory, but browser storage failed. Export a backup before leaving.');
    } catch (error) {
      showMessage(`Could not import this backup. ${error instanceof SyntaxError ? 'The file is not valid JSON.' : error.message} Your current campaign is unchanged.`);
    } finally {
      busy = false;
      selectHex(selectedId);
    }
  });
  $('download-raw').addEventListener('click', () => download(store.raw ?? '', 'dolmenwood-unreadable-data.txt', 'text/plain'));
  $('reset-data').addEventListener('click', async () => {
    if (!window.confirm('Permanently replace the unreadable saved data with an empty map? Download the original data first if you want to keep it.')) return;
    busy = true;
    renderState(store);
    const saved = await store.replace(storage.emptyDataset());
    busy = false;
    selectHex(selectedId);
    showMessage(saved ? 'Saved map reset. Your new journal is ready.' : 'Map reset in memory. Browser storage is unavailable; export your work before leaving.');
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flushOnExit(); });
  window.addEventListener('pagehide', () => store.flushOnExit());
  window.addEventListener('beforeunload', event => {
    store.flushOnExit();
    if (store.state === 'error' && store.hasUnsavedChanges) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  renderState(store);
  store.load().then(() => {
    ready = true;
    selectHex(selectedId);
    layoutMap(1, true);
  });
})();
