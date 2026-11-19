import { Cell, GridPos } from './types';

export interface FlowField {
  rows: number;
  cols: number;
  dist: number[][];
  dirX: number[][];
  dirY: number[][];
}

export function cellKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

export function isWalkableForOrk(
  grid: Cell[][],
  rows: number,
  cols: number,
  gx: number,
  gy: number,
  blocked: ReadonlySet<string>
): boolean {
  if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return false;
  const type = grid[gy][gx].type;
  if (type !== 'floor' && type !== 'spawn' && type !== 'rift') return false;
  if (blocked.has(cellKey(gx, gy))) return false;
  return true;
}

const ORTHO_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const EIGHT_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * Computes a BFS distance field and smooth 8-way flow direction from all Rift tiles.
 * Diagonal steps are only permitted when both adjacent orthogonal cells are walkable
 * so Orks never clip through Barricade or Lava corners.
 */
export function computeFlowField(
  grid: Cell[][],
  rows: number,
  cols: number,
  rifts: ReadonlyArray<GridPos>,
  blocked: ReadonlySet<string>
): FlowField {
  const dist: number[][] = Array.from({ length: rows }, () =>
    Array<number>(cols).fill(Infinity)
  );
  const dirX: number[][] = Array.from({ length: rows }, () =>
    Array<number>(cols).fill(0)
  );
  const dirY: number[][] = Array.from({ length: rows }, () =>
    Array<number>(cols).fill(0)
  );

  const queue: GridPos[] = [];
  for (const rift of rifts) {
    if (rift.gy >= 0 && rift.gy < rows && rift.gx >= 0 && rift.gx < cols) {
      dist[rift.gy][rift.gx] = 0;
      queue.push({ gx: rift.gx, gy: rift.gy });
    }
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const curDist = dist[cur.gy][cur.gx];

    for (const [dx, dy] of ORTHO_DIRS) {
      const nx = cur.gx + dx;
      const ny = cur.gy + dy;
      if (!isWalkableForOrk(grid, rows, cols, nx, ny, blocked)) continue;
      if (dist[ny][nx] > curDist + 1) {
        dist[ny][nx] = curDist + 1;
        queue.push({ gx: nx, gy: ny });
      }
    }
  }

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const d = dist[gy][gx];
      if (!Number.isFinite(d) || d === 0) continue;

      let bestDist = d;
      let bestDx = 0;
      let bestDy = 0;

      for (const [dx, dy] of EIGHT_DIRS) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (!isWalkableForOrk(grid, rows, cols, nx, ny, blocked)) continue;

        // Prevent corner-cutting past walls, lava, or barricades
        if (dx !== 0 && dy !== 0) {
          if (
            !isWalkableForOrk(grid, rows, cols, gx + dx, gy, blocked) ||
            !isWalkableForOrk(grid, rows, cols, gx, gy + dy, blocked)
          ) {
            continue;
          }
        }

        const nd = dist[ny][nx];
        // Slight preference for diagonal smoothness when strictly closer
        const stepPenalty = dx !== 0 && dy !== 0 ? 0.05 : 0;
        if (nd + stepPenalty < bestDist) {
          bestDist = nd + stepPenalty;
          bestDx = dx;
          bestDy = dy;
        }
      }

      const len = Math.hypot(bestDx, bestDy);
      if (len > 0) {
        dirX[gy][gx] = bestDx / len;
        dirY[gy][gx] = bestDy / len;
      }
    }
  }

  return { rows, cols, dist, dirX, dirY };
}

/**
 * Verifies that placing a Barricade at (testGx, testGy) leaves at least one valid path
 * from every Spawn Portal to a Rift tile.
 */
export function canBlockWithoutSealingPath(
  grid: Cell[][],
  rows: number,
  cols: number,
  spawns: ReadonlyArray<GridPos>,
  rifts: ReadonlyArray<GridPos>,
  blocked: ReadonlySet<string>,
  testGx: number,
  testGy: number
): boolean {
  if (!isWalkableForOrk(grid, rows, cols, testGx, testGy, blocked)) {
    return false;
  }
  const type = grid[testGy][testGx].type;
  if (type !== 'floor') return false;

  const nextBlocked = new Set(blocked);
  nextBlocked.add(cellKey(testGx, testGy));

  const field = computeFlowField(grid, rows, cols, rifts, nextBlocked);
  for (const spawn of spawns) {
    if (!Number.isFinite(field.dist[spawn.gy][spawn.gx])) {
      return false;
    }
  }
  return true;
}

/**
 * Extracts a clean tile-by-tile preview path from each Spawn Portal to the Rift.
 */
export function tracePreviewPaths(
  grid: Cell[][],
  rows: number,
  cols: number,
  spawns: ReadonlyArray<GridPos>,
  field: FlowField,
  blocked: ReadonlySet<string>
): GridPos[][] {
  const paths: GridPos[][] = [];

  for (const spawn of spawns) {
    const path: GridPos[] = [{ gx: spawn.gx, gy: spawn.gy }];
    let cx = spawn.gx;
    let cy = spawn.gy;
    const visited = new Set<string>([cellKey(cx, cy)]);

    for (let step = 0; step < rows * cols; step++) {
      const curDist = field.dist[cy][cx];
      if (!Number.isFinite(curDist) || curDist === 0) break;

      let bestNx = cx;
      let bestNy = cy;
      let bestDist = curDist;

      for (const [dx, dy] of ORTHO_DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!isWalkableForOrk(grid, rows, cols, nx, ny, blocked)) continue;
        if (visited.has(cellKey(nx, ny))) continue;
        const nd = field.dist[ny][nx];
        if (nd < bestDist) {
          bestDist = nd;
          bestNx = nx;
          bestNy = ny;
        }
      }

      if (bestNx === cx && bestNy === cy) break;
      cx = bestNx;
      cy = bestNy;
      visited.add(cellKey(cx, cy));
      path.push({ gx: cx, gy: cy });
    }

    paths.push(path);
  }

  return paths;
}
