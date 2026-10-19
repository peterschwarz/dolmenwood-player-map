/* Optional browser QA. Supply an external Playwright module; no app dependencies.
   node tests/browser.cjs /path/to/playwright /path/to/chromium /tmp/map-qa */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = process.argv[4] || '/tmp/dolmenwood-browser-qa';
const key = 'dolmenwood-player-map:local-campaign:v1';

(async () => {
  await fs.mkdir(output, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/dolmenwood-player-map(?=\/)/, '');
      const file = path.resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
      if (!file.startsWith(`${root}${path.sep}`)) { res.writeHead(403).end(); return; }
      const bytes = await fs.readFile(file);
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
      res.end(bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    const url = `${base}/dolmenwood-player-map/`;
    const ready = async () => { await page.locator('#save-status[data-state="saved"]').waitFor(); };
    const terrainReady = async (target = page) => target.locator('#hex-overlay.terrain-ready').waitFor();
    const revealedIds = async (target = page) => target.evaluate(() => {
      const points = new Set([...document.querySelector('#visited-clip').children].map(el => el.getAttribute('points')));
      return DolmenwoodGrid.hexes.filter(hex => points.has(hex.points)).map(hex => hex.id);
    });
    const record = async id => page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)).records[id], { key, id });
    const upload = async (data, accept) => {
      if (accept !== undefined) page.once('dialog', dialog => accept ? dialog.accept() : dialog.dismiss());
      await page.locator('#import-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)) });
    };
    await page.goto(url);
    await ready();
    await terrainReady();
    assert.deepEqual(await revealedIds(), []);
    assert.equal(await page.locator('.hex').count(), 200);
    assert.equal(await page.locator('#hex-select option').count(), 200);
    assert.equal(await page.locator('img').evaluate(img => img.naturalWidth), 5080);
    // Real raster evidence: overlay top edges align with the PNG's grey grid lines.
    const alignment = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 5080; canvas.height = 3627;
      const ctx = canvas.getContext('2d'); ctx.drawImage(document.querySelector('img'), 0, 0);
      const pixels = ctx.getImageData(0, 0, 5080, 3627).data;
      return ['0101', '0201', '0301', '0401', '0905', '1005', '0312', '0412', '1312', '1806', '1901', '1906'].map(id => {
        const hex = DolmenwoodGrid.byId.get(id);
        const y = Math.round(hex.y - 268.25 / 2);
        let hits = 0;
        for (let dx = -40; dx <= 40; dx += 10) {
          const x = Math.round(hex.x + dx);
          let hit = false;
          for (let dy = -2; dy <= 2; dy++) if (pixels[((y + dy) * 5080 + x) * 4] < 235) hit = true;
          if (hit) hits++;
        }
        return { id, hits };
      });
    });
    assert.ok(alignment.every(item => item.hits >= 8), JSON.stringify(alignment));
    const terrainAlignment = await page.evaluate(async () => {
      const img = new Image(); img.src = document.querySelector('#terrain-image').getAttribute('href'); await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
      // The printed grid darkens the underlying colored terrain. Compare row
      // averages around the measured top edge instead of assuming a grey color.
      const results = ['0101', '0201', '0301', '0401', '0905', '1005', '0312', '0412', '1312', '1806', '1901', '1906'].map(id => {
        const hex = DolmenwoodGrid.byId.get(id);
        const rows = Array.from({ length: 15 }, (_, index) => {
          const dy = index - 7;
          let brightness = 0;
          for (let dx = -40; dx <= 40; dx++) {
            const i = (Math.round(hex.y - 268.25 / 2) + dy) * img.width * 4 + Math.round(hex.x + dx) * 4;
            brightness += pixels[i] + pixels[i + 1] + pixels[i + 2];
          }
          return { dy, brightness: brightness / 243 };
        });
        return { id, darkest: rows.reduce((a, b) => a.brightness < b.brightness ? a : b).dy };
      });
      return { width: img.width, height: img.height, results };
    });
    assert.equal(terrainAlignment.width, 5080); assert.equal(terrainAlignment.height, 3627);
    assert.ok(terrainAlignment.results.every(item => Math.abs(item.darkest) <= 2), JSON.stringify(terrainAlignment));
    console.log('PASS: 200 hexes, subpath assets, raster alignment at corners/center and alternating columns');

    // Compare actual rendered pixels with the blank base and unclipped terrain.
    // Controls are hidden only in these screenshots to avoid focus/hover differences.
    const capture = async (extra = '') => (await page.locator('#map-stage').screenshot({
      style: `.message { display: none !important; } .hex { fill: transparent !important; stroke: transparent !important; } ${extra}`,
    })).toString('base64');
    const blank = await capture();
    const terrain = await capture('#terrain-image { clip-path: none; }');
    const checkPixels = async ids => {
      const actual = await capture();
      const result = await page.evaluate(async ({ blank, terrain, actual, ids }) => {
        const decode = async bytes => {
          const img = new Image(); img.src = `data:image/png;base64,${bytes}`; await img.decode();
          const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
          return ctx.getImageData(0, 0, img.width, img.height);
        };
        const [base, art, rendered] = await Promise.all([blank, terrain, actual].map(decode));
        const samples = DolmenwoodGrid.hexes.map(hex => ({ x: hex.x, y: hex.y, revealed: ids.includes(hex.id) }));
        samples.push({ x: 100, y: 100 }, { x: 4800, y: 3400 }, { x: 100, y: 1800 });
        // Include both sides and the shared edge of adjacent 0905/0906.
        const hex = DolmenwoodGrid.byId.get('0905');
        for (const dy of [-12, 0, 12]) samples.push({ x: hex.x, y: hex.y + 268.25 / 2 + dy,
          revealed: ids.includes('0905') && ids.includes('0906') });
        let mismatches = 0, differences = 0;
        for (const sample of samples) {
          const x = Math.floor(sample.x / 5080 * base.width), y = Math.floor(sample.y / 3627 * base.height);
          const i = (y * base.width + x) * 4;
          const expected = sample.revealed ? art : base;
          for (let c = 0; c < 3; c++) {
            if (Math.abs(rendered.data[i + c] - expected.data[i + c]) > 2) mismatches++;
            if (Math.abs(base.data[i + c] - art.data[i + c]) > 2) differences++;
          }
        }
        return { mismatches, differences };
      }, { blank, terrain, actual, ids });
      assert.equal(result.mismatches, 0, JSON.stringify(result));
      assert.ok(result.differences > 50, 'Samples must distinguish artwork from the blank map');
      assert.deepEqual(await revealedIds(), ids);
    };
    await checkPixels([]);
    await page.locator('#hex-select').selectOption('1005'); await page.locator('#visited').check();
    await checkPixels(['1005']);
    await page.locator('#visited').uncheck(); await checkPixels([]);
    for (const id of ['0905', '0906']) {
      await page.locator('#hex-select').selectOption(id); await page.locator('#visited').check();
    }
    await checkPixels(['0905', '0906']);
    const all = await page.evaluate(() => ({ version: 1, mapId: 'dolmenwood-player-map', records:
      Object.fromEntries(DolmenwoodGrid.hexes.map(hex => [hex.id, { visited: true, notes: '', updatedAt: '2026-10-17T12:00:00.000Z' }])) }));
    await upload(all, true); await ready(); await checkPixels(Object.keys(all.records).sort());
    await page.screenshot({ path: path.join(output, 'all-revealed.png'), fullPage: true });
    await upload({ ...all, records: {} }, true); await ready(); await checkPixels([]);
    console.log('PASS: actual pixels for no visits, one visit, unchecking, adjacent shared edges, all visits, blank neighbors and margins');

    await page.locator('[data-hex="0905"]').click();
    assert.equal(await page.locator('#selected-id').textContent(), '0905');
    await page.locator('#notes').fill('<b>Safe plain text</b>\nA second line.');
    await page.locator('#hex-select').selectOption('1005');
    await page.locator('#notes').fill('Next hex');
    await ready();
    assert.equal((await record('0905')).notes, '<b>Safe plain text</b>\nA second line.');
    assert.equal((await record('1005')).notes, 'Next hex');
    await page.locator('#visited').check();
    assert.ok((await page.locator('[data-hex="1005"]').getAttribute('class')).includes('visited'));
    await page.reload(); await ready();
    await terrainReady(); assert.deepEqual(await revealedIds(), ['1005']);
    await page.locator('#hex-select').selectOption('0905');
    assert.equal(await page.locator('#notes').inputValue(), '<b>Safe plain text</b>\nA second line.');
    await page.locator('#notes').fill(''); await ready();
    assert.equal((await record('0905')).notes, '');
    // Reload before the debounce expires must still persist.
    await page.locator('#notes').fill('Before leaving'); await page.reload(); await ready();
    assert.equal((await record('0905')).notes, 'Before leaving');
    console.log('PASS: mouse, rapid switching, autosave, saved terrain reveals, reload, empty/multiline/plain-text notes, exit flush');

    await page.locator('[data-hex="0101"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#selected-id').textContent(), '0201');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#selected-id').textContent(), '0202');
    assert.equal(await page.locator('[data-hex="0202"]').evaluate(el => el.matches(':focus-visible')), true);
    assert.equal(await page.locator('[data-hex="0202"]').evaluate(el => getComputedStyle(el).stroke), 'rgb(23, 76, 112)');
    await page.keyboard.press('End');
    assert.equal(await page.locator('#selected-id').textContent(), '1906');
    await page.keyboard.press('Home');
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#selected-id').textContent(), '0101');
    await page.locator('#zoom-in').click(); await page.locator('#zoom-in').click();
    await page.locator('#hex-select').selectOption('1906');
    assert.ok(await page.locator('#map-viewport').evaluate(el => el.scrollLeft > 0));
    await page.locator('#zoom-out').click(); await page.locator('#zoom-fit').click();
    assert.equal(await page.locator('#zoom-level').textContent(), '100%');
    console.log('PASS: keyboard selection/focus, coordinate jump, zoom, fit and scrolling');

    await page.locator('#notes').fill('Export captures pending edits');
    const downloadEvent = page.waitForEvent('download'); await page.locator('#export').click();
    const download = await downloadEvent; const backup = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    assert.equal(backup.records['1906'].notes, 'Export captures pending edits');
    const changed = JSON.parse(JSON.stringify(backup)); changed.records['1906'].notes = 'Imported content';
    changed.records['1005'].visited = false; changed.records['1906'].visited = true;
    await upload(changed, false); await page.waitForFunction(() => document.querySelector('#message').textContent.includes('cancelled'));
    assert.equal(await page.locator('#notes').inputValue(), 'Export captures pending edits');
    assert.deepEqual(await revealedIds(), ['1005']);
    await upload(changed, true); await page.waitForFunction(() => document.querySelector('#message').textContent.includes('Backup imported:'));
    assert.equal(await page.locator('#notes').inputValue(), 'Imported content');
    assert.deepEqual(await revealedIds(), ['1906']);
    await upload(backup, true); await ready();
    assert.equal((await record('1906')).notes, 'Export captures pending edits');
    for (const data of ['{broken', { ...backup, records: { '9999': backup.records['1906'] } }, { ...backup, version: 2 }]) {
      await upload(data); await page.waitForFunction(() => document.querySelector('#message').textContent.includes('Could not import'));
      assert.equal((await record('1906')).notes, 'Export captures pending edits');
      assert.deepEqual(await revealedIds(), ['1005']);
    }
    console.log('PASS: pending-edit export, backup round trip, import cancellation and invalid imports');
    await page.locator('#hex-select').selectOption('1005');
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    while (await page.locator('#zoom-in').isEnabled()) await page.locator('#zoom-in').click();
    await page.locator('#hex-select').selectOption('1005');
    await page.screenshot({ path: path.join(output, 'desktop-max-zoom.png'), fullPage: true });
    await page.locator('#zoom-fit').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const mapBox = await page.locator('.map-panel').boundingBox(); const journalBox = await page.locator('.journal').boundingBox();
    assert.ok(journalBox.y >= mapBox.y + mapBox.height);
    while (await page.locator('#zoom-in').isEnabled()) await page.locator('#zoom-in').click();
    await page.locator('#hex-select').selectOption('1005');
    await page.screenshot({ path: path.join(output, 'mobile-zoom.png'), fullPage: true });
    console.log('PASS: mobile layout and zoom without page overflow');

    await page.evaluate(key => localStorage.setItem(key, '{unreadable original'), key);
    await page.reload(); await page.locator('#recovery').waitFor();
    assert.equal(await page.locator('#notes').isDisabled(), true);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), '{unreadable original');
    const rawDownloadEvent = page.waitForEvent('download'); await page.locator('#download-raw').click();
    assert.equal(await fs.readFile(await (await rawDownloadEvent).path(), 'utf8'), '{unreadable original');
    page.once('dialog', dialog => dialog.dismiss()); await page.locator('#reset-data').click();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), '{unreadable original');
    page.once('dialog', dialog => dialog.accept()); await page.locator('#reset-data').click(); await ready();
    assert.equal(await page.locator('#notes').isDisabled(), false);
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).records, key), {});
    console.log('PASS: corrupt storage preservation, raw download, reset cancellation and explicit reset');

    await page.evaluate(() => { Storage.prototype.setItem = function () { throw new DOMException('Quota full', 'QuotaExceededError'); }; });
    await page.locator('#notes').fill('Retained after storage failure');
    await page.locator('#save-status[data-state="error"]').waitFor();
    await page.locator('#visited').check(); assert.deepEqual(await revealedIds(), ['0101']);
    await page.locator('#visited').uncheck(); assert.deepEqual(await revealedIds(), []);
    const failedDownloadEvent = page.waitForEvent('download'); await page.locator('#export').click();
    const failedBackup = JSON.parse(await fs.readFile(await (await failedDownloadEvent).path(), 'utf8'));
    assert.equal(failedBackup.records['0101'].notes, 'Retained after storage failure');
    assert.equal(await page.locator('#notes').inputValue(), 'Retained after storage failure');
    console.log('PASS: failed writes retain edits and permit export');
    // New pages for root-relative hosting and direct-file use.
    const rootPage = await context.newPage(); await rootPage.goto(`${base}/`);
    await rootPage.locator('#save-status[data-state="saved"]').waitFor();
    assert.equal(await rootPage.locator('.hex').count(), 200);
    await terrainReady(rootPage);
    assert.equal(await rootPage.locator('img').evaluate(img => img.naturalWidth), 5080);
    const filePage = await context.newPage(); await filePage.goto(`file://${root}/index.html`);
    await filePage.locator('#editor:not([disabled])').waitFor();
    assert.equal(await filePage.locator('.hex').count(), 200);
    assert.equal(await filePage.locator('img').evaluate(img => img.naturalWidth), 5080);
    await terrainReady(filePage);
    await filePage.locator('#visited').check(); assert.deepEqual(await revealedIds(filePage), ['0101']);
    for (const failImage of [false, true]) {
      const loadingContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await loadingContext.addInitScript(({ key, all }) => {
        localStorage.setItem(key, JSON.stringify({ ...all, records: { '0101': all.records['0101'] } }));
      }, { key, all });
      const loadingPage = await loadingContext.newPage();
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await loadingPage.route('**/Dolmenwood%20VTT%20Hex%20Map.png', async route => {
        await gate;
        if (failImage) await route.abort(); else await route.continue();
      });
      await loadingPage.goto(url, { waitUntil: 'domcontentloaded' });
      await loadingPage.locator('#save-status[data-state="saved"]').waitFor();
      assert.equal(await loadingPage.locator('#terrain-image').getAttribute('visibility'), 'hidden');
      assert.equal(await loadingPage.locator('#terrain-image').getAttribute('clip-path'), 'url(#visited-clip)');
      assert.equal(await loadingPage.locator('#terrain-image').getAttribute('aria-hidden'), 'true');
      assert.equal(await loadingPage.locator('#terrain-image').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
      assert.deepEqual(await revealedIds(loadingPage), ['0101']);
      assert.equal(await loadingPage.locator('[data-hex="0101"]').evaluate(el => getComputedStyle(el).fill), 'rgba(67, 143, 85, 0.26)');
      await loadingPage.locator('#visited').uncheck();
      await loadingPage.locator('#hex-select').selectOption('0201'); await loadingPage.locator('#visited').check();
      assert.deepEqual(await revealedIds(loadingPage), ['0201']);
      release();
      if (failImage) {
        await loadingPage.locator('#map-image-error').waitFor();
        assert.equal(await loadingPage.locator('#save-status').getAttribute('data-state'), 'saved');
        assert.equal(await loadingPage.locator('[data-hex="0201"]').evaluate(el => getComputedStyle(el).fill), 'rgba(67, 143, 85, 0.26)');
        await loadingPage.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Storage failed'); }; });
        await loadingPage.locator('#notes').fill('Still editable when both image and saving fail');
        await loadingPage.locator('#save-status[data-state="error"]').waitFor();
        assert.equal(await loadingPage.locator('#map-image-error').isVisible(), true);
        await loadingPage.locator('#visited').uncheck(); assert.deepEqual(await revealedIds(loadingPage), []);
      } else {
        await terrainReady(loadingPage);
        assert.equal(await loadingPage.locator('#map-image-error').isHidden(), true);
        assert.equal(await loadingPage.locator('[data-hex="0201"]').evaluate(el => getComputedStyle(el).fill), 'rgba(0, 0, 0, 0)');
        assert.deepEqual(await revealedIds(loadingPage), ['0201']);
        await loadingPage.locator('[data-hex="0201"]').click();
        assert.equal(await loadingPage.locator('#selected-id').textContent(), '0201');
      }
      await loadingContext.close();
    }
    console.log('PASS: slow image starts hidden/clipped, green fallback, edits during loading, failed image and independent save error');
    assert.deepEqual(errors, []);
    console.log('PASS: root hosting, direct file opening, no browser script errors');
    console.log(`Screenshots: ${output}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
