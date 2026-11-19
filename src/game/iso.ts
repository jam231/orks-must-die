import {
  CameraState,
  Cell,
  ISO_TILE_H,
  ISO_TILE_W,
  ISO_WALL_H,
  Vec2,
  WallFace,
} from './types';

/**
 * Converts continuous grid coordinates (gx, gy) and vertical height z (px)
 * into isometric world coordinates (px).
 * Tile (gx, gy) center is at (gx + 0.5, gy + 0.5).
 */
export function gridToIso(gx: number, gy: number, z = 0): Vec2 {
  return {
    x: (gx - gy) * (ISO_TILE_W * 0.5),
    y: (gx + gy) * (ISO_TILE_H * 0.5) - z,
  };
}

/**
 * Inverse projection from isometric world coordinates (at ground z=0) to continuous grid coordinates.
 */
export function isoToGrid(wx: number, wy: number): { gx: number; gy: number } {
  const halfW = ISO_TILE_W * 0.5;
  const halfH = ISO_TILE_H * 0.5;
  const gx = (wx / halfW + wy / halfH) * 0.5;
  const gy = (wy / halfH - wx / halfW) * 0.5;
  return { gx, gy };
}

/**
 * Converts isometric world coordinates to canvas CSS pixel coordinates.
 */
export function worldToScreen(
  wx: number,
  wy: number,
  camera: CameraState,
  viewportW: number,
  viewportH: number
): Vec2 {
  return {
    x: (wx - camera.x) * camera.zoom + viewportW * 0.5,
    y: (wy - camera.y) * camera.zoom + viewportH * 0.5,
  };
}

/**
 * Converts canvas CSS pixel coordinates to isometric world coordinates.
 */
export function screenToWorld(
  sx: number,
  sy: number,
  camera: CameraState,
  viewportW: number,
  viewportH: number
): Vec2 {
  return {
    x: (sx - viewportW * 0.5) / camera.zoom + camera.x,
    y: (sy - viewportH * 0.5) / camera.zoom + camera.y,
  };
}

/**
 * Returns the 4 diamond corners of tile (gx, gy) in isometric world coordinates at elevation z.
 * Order: Top (N), Right (E), Bottom (S), Left (W).
 */
export function getTileDiamond(gx: number, gy: number, z = 0): [Vec2, Vec2, Vec2, Vec2] {
  return [
    gridToIso(gx, gy, z), // Top
    gridToIso(gx + 1, gy, z), // Right
    gridToIso(gx + 1, gy + 1, z), // Bottom
    gridToIso(gx, gy + 1, z), // Left
  ];
}

/**
 * Returns the 4 polygon corners of a wall's exposed vertical face ('se' or 'sw') in iso world space.
 * 'se' face borders (gx + 1, gy): Right-to-Bottom edge extruded upward by ISO_WALL_H.
 * 'sw' face borders (gx, gy + 1): Left-to-Bottom edge extruded upward by ISO_WALL_H.
 */
export function getWallFaceQuad(
  gx: number,
  gy: number,
  face: WallFace,
  wallHeight = ISO_WALL_H
): [Vec2, Vec2, Vec2, Vec2] {
  const base = getTileDiamond(gx, gy, 0);
  const top = getTileDiamond(gx, gy, wallHeight);
  if (face === 'se') {
    // Edge from Right (1) to Bottom (2)
    return [top[1], top[2], base[2], base[1]];
  }
  // 'sw': Edge from Left (3) to Bottom (2)
  return [top[3], top[2], base[2], base[3]];
}

function pointInPolygon(px: number, py: number, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface WallPickResult {
  gx: number;
  gy: number;
  face: WallFace;
}

/**
 * Picks the front-most valid wall face ('se' or 'sw') under world coordinate (wx, wy).
 * Also checks the raised wall top cap and snaps to the closest valid face for generous touch ergonomics.
 */
export function pickWallFace(
  wx: number,
  wy: number,
  grid: Cell[][],
  rows: number,
  cols: number,
  isValidFace: (gx: number, gy: number, face: WallFace) => boolean
): WallPickResult | null {
  let best: (WallPickResult & { depth: number }) | null = null;

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      if (grid[gy][gx].type !== 'wall') continue;
      const depth = gx + gy;
      const faces: WallFace[] = ['se', 'sw'];
      for (const face of faces) {
        if (!isValidFace(gx, gy, face)) continue;
        const quad = getWallFaceQuad(gx, gy, face);
        if (pointInPolygon(wx, wy, quad)) {
          if (!best || depth >= best.depth) {
            best = { gx, gy, face, depth };
          }
        }
      }

      // Generous touch fallback: tapping the top of a wall block picks its valid face
      const topPoly = getTileDiamond(gx, gy, ISO_WALL_H);
      if (pointInPolygon(wx, wy, topPoly)) {
        const seOk = isValidFace(gx, gy, 'se');
        const swOk = isValidFace(gx, gy, 'sw');
        if (seOk || swOk) {
          let face: WallFace;
          if (seOk && !swOk) {
            face = 'se';
          } else if (swOk && !seOk) {
            face = 'sw';
          } else {
            const center = gridToIso(gx + 0.5, gy + 0.5, ISO_WALL_H);
            face = wx >= center.x ? 'se' : 'sw';
          }
          if (!best || depth >= best.depth) {
            best = { gx, gy, face, depth };
          }
        }
      }
    }
  }

  return best ? { gx: best.gx, gy: best.gy, face: best.face } : null;
}

/**
 * Computes the bounding box of a tile grid in isometric world space.
 */
export function computeMapWorldBounds(rows: number, cols: number): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
} {
  const top = gridToIso(0, 0, ISO_WALL_H);
  const right = gridToIso(cols, 0, 0);
  const bottom = gridToIso(cols, rows, 0);
  const left = gridToIso(0, rows, 0);

  const minX = left.x - 40;
  const maxX = right.x + 40;
  const minY = top.y - 40;
  const maxY = bottom.y + 40;

  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
  };
}
