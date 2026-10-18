# Dolmenwood player map

A dependency-free, static player map with 200 selectable numbered hexes, a personal field journal, visited markers, and JSON backups. The supplied PNG is preserved unchanged; an SVG overlay provides the interactions.

## Open the map

Open `index.html` in a modern browser. No installation, build step, application server, or account is required. All assets are included in this directory; the app makes no external requests.

For static hosting, upload this entire directory to your host. It works at the host’s root or at a subpath such as `https://example.com/dolmenwood-player-map/`. Keep the PNG’s filename and the directory structure intact. Every asset reference is relative.

An optional local HTTP preview, from the parent directory:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/dolmenwood-player-map/`. HTTP hosting gives browser storage a stable origin; direct `file://` storage behavior depends on the browser.

## Use it

- Click or tap a numbered hex, or choose its coordinate from **Jump to a hex**. Unnumbered margin hexes are excluded, while numbered hexes outside the woodland boundary remain selectable.
- Write plain-text notes and check **Visited this hex** to give that hex a translucent green fill. The selected hex has an amber outline.
- Notes save after a 400 ms typing pause. Visited changes save immediately. Switching hexes, exporting, importing, hiding the tab, or leaving the page flushes pending edits.
- Use **+**, **−**, and **Fit map** to zoom from 100% to 800% of the fitted size. Scroll the map with a mouse, trackpad, touch, or the scrollable region’s keyboard controls. Coordinate jumps bring the chosen hex into view.
- Tab to the selected hex. Arrow keys move to a nearby hex and select it; Enter or Space selects the focused hex. Home and End select the first and last numbered hex. A blue dashed outline indicates keyboard focus. The coordinate selector is an alternative to navigating the SVG.
- The journal sits beside the map on desktop and below it on narrow screens.

## Saving, backups, and recovery

The save indicator shows saving, saved, or failure states. Data lives in this browser profile’s local storage. It is specific to the origin (scheme, hostname, and port), so moving from a local file to a hosted site, changing ports, using a different browser, or clearing browser data will not carry your journal over. Private browsing may discard it when the session ends. Use one editing tab at a time; simultaneous edits in different tabs are not synchronized.

**Export backup** downloads a JSON file containing the complete campaign, including edits still waiting for autosave. Export regularly, especially before changing browsers or hosting locations.

**Import backup** validates the map, schema version, every coordinate, and every record before asking to replace the current campaign. It replaces the whole dataset rather than merging. Cancelling or submitting an invalid file leaves the current campaign intact.

If a write fails, your edits remain in memory and visited colors still update. Use **Retry** or export a backup before closing the page. The app attempts to warn before leaving with unsaved edits, but browser shutdowns and mobile tab eviction cannot guarantee a warning.

If existing data is unreadable or has an unsupported schema, the app pauses editing and preserves the original stored string. **Download original data** saves that exact string. **Reset saved map…** requires confirmation before replacing it with an empty campaign; importing a valid backup also requires confirmation. Recovery never silently overwrites unreadable data.

## Files and data contract

```text
index.html                   Page structure and accessible controls
styles.css                   Responsive map and journal layout
js/grid.js                   Image-space geometry and numbered coverage
js/storage.js                Dataset validation, persistence, and autosave
js/app.js                    Selection, zoom, journal, and backup UI
Dolmenwood Blank Hex Map.png  Original 5080 × 3627 image
tests/data.test.cjs           Dependency-free grid/persistence checks
tests/browser.cjs             Optional browser interaction checks
```

The JavaScript modules are isolated closures loaded as ordered deferred classic scripts. This keeps responsibilities separate while supporting direct file opening without the restrictions of browser ES-module imports over `file://`. Notes are assigned to textarea values and text content, never interpreted as HTML.

One dataset is stored under `dolmenwood-player-map:local-campaign:v1`:

```json
{
  "version": 1,
  "mapId": "dolmenwood-player-map",
  "records": {
    "0101": {
      "notes": "A curious encounter.\nReturn at dusk.",
      "visited": true,
      "updatedAt": "2026-10-17T12:00:00.000Z"
    }
  }
}
```

Records are keyed by valid four-digit hex IDs. Timestamps are UTC ISO strings with milliseconds. Empty notes and an unvisited state are valid and persist. An untouched hex has no record. Imports preserve timestamps and normalize accepted records to the documented fields.

The grid uses original image pixels: first center `(447.6, 274.65)`, column spacing `232.515`, row spacing `268.25`, and a half-row offset for even columns. Explicit row counts per column exclude the unnumbered margins. The SVG and image always share the same scale.

`CampaignStore` accepts an adapter with asynchronous `read()` and `write(dataset)` methods. `read()` returns the serialized dataset or `null`; `write()` persists a complete snapshot or rejects. Writes are serialized, and each snapshot retains the edits’ original hex IDs. The local adapter also has a synchronous `writeOnExit(dataset)` hook to flush during page teardown without waiting for a promise. A future remote adapter would need its own durable queue and page-exit strategy.

This release supports one map and one local campaign. Accounts, multiple campaigns, collaboration, and conflict resolution are deferred. A shared session requires a backend, authentication and authorization decisions, synchronization, and a conflict-resolution design; asynchronous adapters alone do not provide those features.

## Verification

Run the lightweight checks with Node.js (no packages required):

```sh
node --test dolmenwood-player-map/tests/data.test.cjs
```

From inside this directory, use `node --test tests/data.test.cjs` instead.

The optional browser suite uses an externally installed Playwright and Chromium. It starts and stops its own loopback HTTP server and writes screenshots outside the app:

```sh
node tests/browser.cjs /absolute/path/to/playwright /absolute/path/to/chromium /tmp/dolmenwood-qa
```

Verified with Chromium: all 200 polygons; raster alignment at corners, center, and alternating columns; mouse and keyboard selection; visible keyboard focus; zoom, fit, and scrolling; desktop and 390 px mobile layouts; debounce and immediate saves; rapid switching; reload and page-exit persistence; empty, multiline, and plain-text notes; pending-edit export; backup round trips; import cancellation and invalid imports; corrupt-data preservation, raw download, and explicit reset; failed-write export; root and subpath hosting; and direct-file loading. The data suite additionally checks asynchronous write ordering and successful retry after a storage failure. Other browsers have not been independently exercised.
