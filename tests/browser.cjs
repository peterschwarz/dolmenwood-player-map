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
    const record = async id => page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)).records[id], { key, id });
    const upload = async (data, accept) => {
      if (accept !== undefined) page.once('dialog', dialog => accept ? dialog.accept() : dialog.dismiss());
      await page.locator('#import-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)) });
    };
    await page.goto(url);
    await ready();
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
    console.log('PASS: 200 hexes, subpath assets, raster alignment at corners/center and alternating columns');

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
    await page.locator('#hex-select').selectOption('0905');
    assert.equal(await page.locator('#notes').inputValue(), '<b>Safe plain text</b>\nA second line.');
    await page.locator('#notes').fill(''); await ready();
    assert.equal((await record('0905')).notes, '');
    // Reload before the debounce expires must still persist.
    await page.locator('#notes').fill('Before leaving'); await page.reload(); await ready();
    assert.equal((await record('0905')).notes, 'Before leaving');
    console.log('PASS: mouse, rapid switching, autosave, visited colors, reload, empty/multiline/plain-text notes, exit flush');

    await page.locator('[data-hex="0101"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#selected-id').textContent(), '0201');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#selected-id').textContent(), '0202');
    assert.equal(await page.locator('[data-hex="0202"]').evaluate(el => el.matches(':focus-visible')), true);
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
    await upload(changed, false); await page.waitForFunction(() => document.querySelector('#message').textContent.includes('cancelled'));
    assert.equal(await page.locator('#notes').inputValue(), 'Export captures pending edits');
    await upload(changed, true); await page.waitForFunction(() => document.querySelector('#message').textContent.includes('Backup imported:'));
    assert.equal(await page.locator('#notes').inputValue(), 'Imported content');
    await upload(backup, true); await ready();
    assert.equal((await record('1906')).notes, 'Export captures pending edits');
    for (const data of ['{broken', { ...backup, records: { '9999': backup.records['1906'] } }, { ...backup, version: 2 }]) {
      await upload(data); await page.waitForFunction(() => document.querySelector('#message').textContent.includes('Could not import'));
      assert.equal((await record('1906')).notes, 'Export captures pending edits');
    }
    console.log('PASS: pending-edit export, backup round trip, import cancellation and invalid imports');
    await page.locator('#hex-select').selectOption('1005');
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const mapBox = await page.locator('.map-panel').boundingBox(); const journalBox = await page.locator('.journal').boundingBox();
    assert.ok(journalBox.y >= mapBox.y + mapBox.height);
    await page.locator('#zoom-in').click();
    await page.locator('#hex-select').selectOption('0312');
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
    const failedDownloadEvent = page.waitForEvent('download'); await page.locator('#export').click();
    const failedBackup = JSON.parse(await fs.readFile(await (await failedDownloadEvent).path(), 'utf8'));
    assert.equal(failedBackup.records['0101'].notes, 'Retained after storage failure');
    assert.equal(await page.locator('#notes').inputValue(), 'Retained after storage failure');
    console.log('PASS: failed writes retain edits and permit export');
    // New pages for root-relative hosting and direct-file use.
    const rootPage = await context.newPage(); await rootPage.goto(`${base}/`);
    await rootPage.locator('#save-status[data-state="saved"]').waitFor();
    assert.equal(await rootPage.locator('.hex').count(), 200);
    const filePage = await context.newPage(); await filePage.goto(`file://${root}/index.html`);
    await filePage.locator('#editor:not([disabled])').waitFor();
    assert.equal(await filePage.locator('.hex').count(), 200);
    assert.equal(await filePage.locator('img').evaluate(img => img.naturalWidth), 5080);
    assert.deepEqual(errors, []);
    console.log('PASS: root hosting, direct file opening, no browser script errors');
    console.log(`Screenshots: ${output}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
