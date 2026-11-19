import { cellKey } from './pathfinding';
import { Cell, Enemy, Hero, PlacedTrap } from './types';

export function createHero(startGx: number, startGy: number): Hero {
  return {
    gx: startGx + 0.5,
    gy: startGy + 0.5,
    z: 0,
    vx: 0,
    vy: 0,
    facingX: -0.7,
    facingY: -0.7,
    moveSpeed: 4.35,
    attackRange: 4.6,
    attackCooldown: 0,
    attackInterval: 0.34,
    attackDamage: 32,
    targetEnemyId: null,
    blastCooldown: 0,
    blastMaxCooldown: 5.5,
    frostCooldown: 0,
    frostMaxCooldown: 8.5,
    dashCooldown: 0,
    dashMaxCooldown: 3.4,
    dashTimer: 0,
    dashDirX: 0,
    dashDirY: -1,
    walkPhase: 0,
    recoilAnim: 0,
    castAnim: 0,
  };
}

/**
 * Checks whether a continuous point (gx, gy) is walkable by the Warmage.
 * Warmage can walk over Barricades (jumping/vaulting friendly defenses!) just like OMD,
 * while walls and lava block movement.
 */
export function canHeroStandAt(
  grid: Cell[][],
  rows: number,
  cols: number,
  gx: number,
  gy: number,
  radius = 0.24
): boolean {
  const offsets: ReadonlyArray<readonly [number, number]> = [
    [radius, radius],
    [radius, -radius],
    [-radius, radius],
    [-radius, -radius],
  ];

  for (const [ox, oy] of offsets) {
    const cx = Math.floor(gx + ox);
    const cy = Math.floor(gy + oy);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
    const type = grid[cy][cx].type;
    if (type !== 'floor' && type !== 'spawn' && type !== 'rift') {
      return false;
    }
  }
  return true;
}

/**
 * Moves the Warmage with smooth axis-separated collision sliding.
 * Input (moveScreenX, moveScreenY) is in screen space (right=+x, down=+y)
 * and gets rotated into isometric grid coordinates so pushing "up" on the joystick
 * moves straight UP on screen!
 */
export function moveHeroScreenSpace(
  hero: Hero,
  screenMoveX: number,
  screenMoveY: number,
  dt: number,
  grid: Cell[][],
  rows: number,
  cols: number
): void {
  // Screen right (+1, 0) corresponds to iso (+gx, -gy)
  // Screen down (0, +1) corresponds to iso (+gx, +gy)
  // Accounting for 2:1 iso ratio so visual speed feels isotropic on screen:
  let gdx = screenMoveX * 0.5 + screenMoveY;
  let gdy = -screenMoveX * 0.5 + screenMoveY;

  const len = Math.hypot(gdx, gdy);
  if (len > 0.001) {
    gdx /= len;
    gdy /= len;
    const mag = Math.min(1, Math.hypot(screenMoveX, screenMoveY));
    gdx *= mag;
    gdy *= mag;
  }

  let speed = hero.moveSpeed;
  if (hero.dashTimer > 0) {
    gdx = hero.dashDirX;
    gdy = hero.dashDirY;
    speed = hero.moveSpeed * 3.1;
  }

  hero.vx = gdx * speed;
  hero.vy = gdy * speed;

  if (Math.hypot(hero.vx, hero.vy) > 0.1) {
    const nextX = hero.gx + hero.vx * dt;
    if (canHeroStandAt(grid, rows, cols, nextX, hero.gy)) {
      hero.gx = nextX;
    }
    const nextY = hero.gy + hero.vy * dt;
    if (canHeroStandAt(grid, rows, cols, hero.gx, nextY)) {
      hero.gy = nextY;
    }
    hero.walkPhase += dt * (hero.dashTimer > 0 ? 18 : 11);

    // Update facing toward movement when not actively firing at a target
    if (hero.targetEnemyId === null) {
      const mlen = Math.hypot(gdx, gdy);
      if (mlen > 0.01) {
        hero.facingX = gdx / mlen;
        hero.facingY = gdy / mlen;
      }
    }
  }
}

/**
 * Simple DDA / stepped line-of-sight check so Warmage bolts don't shoot through solid walls.
 */
export function hasLineOfSight(
  grid: Cell[][],
  rows: number,
  cols: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): boolean {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(2, Math.ceil(dist * 4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = Math.floor(x0 + (x1 - x0) * t);
    const cy = Math.floor(y0 + (y1 - y0) * t);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
    if (grid[cy][cx].type === 'wall') return false;
  }
  return true;
}

/**
 * Smart auto-aim target selector:
 * 1. Prioritizes Sappers threatening a Barricade.
 * 2. Prioritizes Orks closest to the Rift (lowest flow-field distance).
 * 3. Breaks ties by proximity to the Warmage.
 */
export function pickSmartAutoAimTarget(
  hero: Hero,
  enemies: ReadonlyArray<Enemy>,
  traps: ReadonlyArray<PlacedTrap>,
  flowDist: number[][],
  grid: Cell[][],
  rows: number,
  cols: number
): Enemy | null {
  const hasBarricades = traps.some((t) => t.kind === 'barricade' && t.hp > 0);
  const barricadeKeys = new Set(
    traps.filter((t) => t.kind === 'barricade' && t.hp > 0).map((t) => cellKey(t.gx, t.gy))
  );

  let best: Enemy | null = null;
  let bestScore = -Infinity;

  for (const e of enemies) {
    if (e.dead) continue;
    const d = Math.hypot(e.gx - hero.gx, e.gy - hero.gy);
    if (d > hero.attackRange) continue;
    if (!hasLineOfSight(grid, rows, cols, hero.gx, hero.gy, e.gx, e.gy)) continue;

    const ex = Math.max(0, Math.min(cols - 1, Math.floor(e.gx)));
    const ey = Math.max(0, Math.min(rows - 1, Math.floor(e.gy)));
    const riftDist = Number.isFinite(flowDist[ey][ex]) ? flowDist[ey][ex] : 20;

    let score = 40 - riftDist * 2.2 - d * 1.4;
    if (e.kind === 'sapper' && hasBarricades) {
      score += 24;
      if (e.fuseTimer > 0) score += 20;
    }
    if (e.kind === 'kobold' && riftDist < 6) {
      score += 12;
    }
    if (barricadeKeys.has(cellKey(ex, ey))) {
      score += 8;
    }

    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }

  return best;
}
