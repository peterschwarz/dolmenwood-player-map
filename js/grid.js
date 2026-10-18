/* Logical modules use deferred classic scripts so file:// also works. */
(() => {
  'use strict';
  const width = 5080;
  const height = 3627;
  // Measured in original PNG pixels. Flat-top hexes; even columns sit half a row lower.
  const firstX = 447.6;
  const firstY = 274.65;
  const columnStep = 232.515;
  const rowStep = 268.25;
  const radius = columnStep * 2 / 3;
  // Only printed coordinates, including numbered hexes outside the woodland boundary.
  const rowsPerColumn = [11, 11, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 10, 9, 8, 7, 6, 6];
  const hexes = rowsPerColumn.flatMap((rows, columnIndex) =>
    Array.from({ length: rows }, (_, rowIndex) => {
      const column = columnIndex + 1;
      const row = rowIndex + 1;
      const id = `${String(column).padStart(2, '0')}${String(row).padStart(2, '0')}`;
      const x = firstX + columnIndex * columnStep;
      const y = firstY + rowIndex * rowStep + (column % 2 === 0 ? rowStep / 2 : 0);
      const points = [[-radius, 0], [-radius / 2, -rowStep / 2], [radius / 2, -rowStep / 2],
        [radius, 0], [radius / 2, rowStep / 2], [-radius / 2, rowStep / 2]]
        .map(([dx, dy]) => `${(x + dx).toFixed(2)},${(y + dy).toFixed(2)}`).join(' ');
      return Object.freeze({ id, column, row, x, y, points });
    }));
  const byId = new Map(hexes.map(hex => [hex.id, hex]));
  function neighbor(id, key) {
    const current = byId.get(id);
    if (!current) return null;
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      return hexes.find(hex => hex.column === current.column && hex.row === current.row + (key === 'ArrowUp' ? -1 : 1)) || null;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const column = current.column + (key === 'ArrowLeft' ? -1 : 1);
      return hexes.filter(hex => hex.column === column)
        .sort((a, b) => Math.abs(a.y - current.y) - Math.abs(b.y - current.y) || a.row - b.row)[0] || null;
    }
    return null;
  }
  window.DolmenwoodGrid = Object.freeze({ width, height, hexes, byId, neighbor });
})();
