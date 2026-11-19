import { canBlockWithoutSealingPath, cellKey } from './pathfinding';
import {
  CARDINAL_ORDER,
  CARDINAL_VECTORS,
  CardinalDir,
  Cell,
  GridPos,
  PlacedTrap,
  TRAP_SPECS,
  TrapKind,
  WallFace,
} from './types';

export interface TrapValidationResult {
  valid: boolean;
  reason?: string;
  facing?: CardinalDir;
}

/**
 * Checks whether a wall face ('se' or 'sw') on tile (gx, gy) opens onto a corridor tile
 * and is free of any existing Arrow Wall on that face.
 */
export function isValidWallTrapFace(
  grid: Cell[][],
  rows: number,
  cols: number,
  traps: ReadonlyArray<PlacedTrap>,
  gx: number,
  gy: number,
  face: WallFace
): boolean {
  if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return false;
  if (grid[gy][gx].type !== 'wall') return false;

  const targetX = face === 'se' ? gx + 1 : gx;
  const targetY = face === 'sw' ? gy + 1 : gy;
  if (targetX < 0 || targetY < 0 || targetX >= cols || targetY >= rows) {
    return false;
  }

  const adjType = grid[targetY][targetX].type;
  if (adjType !== 'floor' && adjType !== 'lava' && adjType !== 'spawn') {
    return false;
  }

  const alreadyOccupied = traps.some(
    (t) => t.kind === 'arrow_wall' && t.gx === gx && t.gy === gy && t.wallFace === face
  );
  return !alreadyOccupied;
}

/**
 * Smartly picks the best default facing direction for a Spring Flip Trap:
 * prioritizes pointing directly toward a Lava tile within 1–2 tiles!
 */
export function chooseSmartFlipFacing(
  grid: Cell[][],
  rows: number,
  cols: number,
  gx: number,
  gy: number
): CardinalDir {
  // Check distance 1 first, then distance 2 for Lava
  for (let dist = 1; dist <= 2; dist++) {
    for (const dir of CARDINAL_ORDER) {
      const vec = CARDINAL_VECTORS[dir];
      const tx = gx + vec.dx * dist;
      const ty = gy + vec.dy * dist;
      if (tx >= 0 && ty >= 0 && tx < cols && ty < rows) {
        if (grid[ty][tx].type === 'lava') {
          return dir;
        }
      }
    }
  }
  // Otherwise prefer launching back toward NW / NE (away from Rift) if open
  for (const dir of ['nw', 'ne', 'se', 'sw'] as CardinalDir[]) {
    const vec = CARDINAL_VECTORS[dir];
    const tx = gx + vec.dx;
    const ty = gy + vec.dy;
    if (tx >= 0 && ty >= 0 && tx < cols && ty < rows) {
      if (grid[ty][tx].type === 'floor') return dir;
    }
  }
  return 'se';
}

export function rotateCardinalDir(dir: CardinalDir): CardinalDir {
  const idx = CARDINAL_ORDER.indexOf(dir);
  return CARDINAL_ORDER[(idx + 1) % CARDINAL_ORDER.length];
}

/**
 * Validates whether a trap of `kind` can be placed at (gx, gy) (and optional `wallFace`).
 */
export function validateTrapPlacement(
  kind: TrapKind,
  gx: number,
  gy: number,
  wallFace: WallFace | undefined,
  grid: Cell[][],
  rows: number,
  cols: number,
  spawns: ReadonlyArray<GridPos>,
  rifts: ReadonlyArray<GridPos>,
  traps: ReadonlyArray<PlacedTrap>,
  blocked: ReadonlySet<string>,
  coin: number
): TrapValidationResult {
  const spec = TRAP_SPECS[kind];

  if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) {
    return { valid: false, reason: 'Out of bounds' };
  }

  const cell = grid[gy][gx];

  if (spec.surface === 'wall') {
    if (!wallFace) {
      return { valid: false, reason: 'Select a masonry wall face' };
    }
    if (!isValidWallTrapFace(grid, rows, cols, traps, gx, gy, wallFace)) {
      return { valid: false, reason: 'Requires open wall face' };
    }
    if (coin < spec.cost) {
      return { valid: false, reason: `Need ${spec.cost}g` };
    }
    return { valid: true, facing: wallFace };
  }

  if (spec.surface === 'ceiling') {
    if (!cell.hasArch || cell.type !== 'floor') {
      return { valid: false, reason: 'Place under stone archways' };
    }
    const existingCeiling = traps.some(
      (t) => t.gx === gx && t.gy === gy && TRAP_SPECS[t.kind].surface === 'ceiling'
    );
    if (existingCeiling) {
      return { valid: false, reason: 'Archway occupied' };
    }
    if (coin < spec.cost) {
      return { valid: false, reason: `Need ${spec.cost}g` };
    }
    return { valid: true, facing: 'se' };
  }

  // Floor or Blocker traps
  if (cell.type !== 'floor') {
    return { valid: false, reason: 'Place on stone floor' };
  }

  const occupiedFloor = traps.some(
    (t) =>
      t.gx === gx &&
      t.gy === gy &&
      (TRAP_SPECS[t.kind].surface === 'floor' || TRAP_SPECS[t.kind].surface === 'blocker')
  );
  if (occupiedFloor) {
    return { valid: false, reason: 'Tile already has a floor trap' };
  }

  if (kind === 'barricade') {
    const canBlock = canBlockWithoutSealingPath(
      grid,
      rows,
      cols,
      spawns,
      rifts,
      blocked,
      gx,
      gy
    );
    if (!canBlock) {
      return { valid: false, reason: 'Path Blocked!' };
    }
  }

  if (coin < spec.cost) {
    return { valid: false, reason: `Need ${spec.cost}g` };
  }

  const facing =
    kind === 'flip' ? chooseSmartFlipFacing(grid, rows, cols, gx, gy) : 'se';

  return { valid: true, facing };
}

/**
 * Builds the set of tile keys currently blocked by live Barricades.
 */
export function buildBlockedSet(traps: ReadonlyArray<PlacedTrap>): Set<string> {
  const blocked = new Set<string>();
  for (const t of traps) {
    if (t.kind === 'barricade' && t.hp > 0) {
      blocked.add(cellKey(t.gx, t.gy));
    }
  }
  return blocked;
}

export function getTrapSellRefund(trap: PlacedTrap, isPrepPhase: boolean): number {
  const cost = TRAP_SPECS[trap.kind].cost;
  if (isPrepPhase && trap.placedDuringPrep) {
    return cost;
  }
  return Math.round(cost * 0.5);
}
