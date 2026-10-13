/**
 * Monitor wall layout: all drones on one screen, as large as possible, no scrolling (tablet,
 * kiosk, laptop). Phones scroll a single column instead (overview.css).
 */
export interface WallGrid {
  cols: number;
  rows: number;
}

export interface WallLayout {
  landscape: WallGrid;
  portrait: WallGrid;
}

function grid(count: number, cols: number): WallGrid {
  const c = Math.max(1, Math.min(cols, count));
  return { cols: c, rows: Math.max(1, Math.ceil(count / c)) };
}

export function wallLayout(count: number): WallLayout {
  return {
    // 16:9 pictures on a wide screen: as square a grid as possible (4 → 2×2, 6 → 3×2, 9 → 3×3).
    landscape: grid(count, Math.ceil(Math.sqrt(count))),
    // Upright tablet: one column up to three drones, then two.
    portrait: grid(count, count <= 3 ? 1 : 2),
  };
}
