import {
  ComboEntry,
  ENEMY_SPECS,
  Enemy,
  EnemyKind,
  PlacedTrap,
} from './types';

export const COMBO_WINDOW_SEC = 4.5;

export function createEnemy(
  id: number,
  kind: EnemyKind,
  spawnGx: number,
  spawnGy: number,
  waveIndex: number
): Enemy {
  const spec = ENEMY_SPECS[kind];
  // Mild wave scaling so later waves stay punchy without bullet-sponge drag
  const hpScale = 1 + Math.max(0, waveIndex) * 0.08;
  const maxHp = Math.round(spec.maxHp * hpScale);
  const jitterX = (Math.random() - 0.5) * 0.28;
  const jitterY = (Math.random() - 0.5) * 0.28;

  return {
    id,
    kind,
    gx: spawnGx + 0.5 + jitterX,
    gy: spawnGy + 0.5 + jitterY,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    facingX: 0.7,
    facingY: 0.7,
    hp: maxHp,
    maxHp,
    tarTimer: 0,
    freezeTimer: 0,
    staggerTimer: 0,
    hitFlash: 0,
    walkPhase: Math.random() * Math.PI * 2,
    airborne: false,
    attackCooldown: 0,
    fuseTimer: 0,
    comboTags: [],
    dead: false,
  };
}

/**
 * Records a unique combat/trap source tag on an enemy for OMD combo calculation.
 */
export function tagEnemyCombo(enemy: Enemy, source: string, now: number): void {
  const existing = enemy.comboTags.find((c) => c.source === source);
  if (existing) {
    existing.time = now;
  } else {
    enemy.comboTags.push({ source, time: now });
  }
}

/**
 * Counts distinct active combo tags within COMBO_WINDOW_SEC.
 */
export function getActiveComboCount(enemy: Enemy, now: number): number {
  let count = 0;
  for (let i = enemy.comboTags.length - 1; i >= 0; i--) {
    const entry: ComboEntry = enemy.comboTags[i];
    if (now - entry.time <= COMBO_WINDOW_SEC) {
      count++;
    } else {
      enemy.comboTags.splice(i, 1);
    }
  }
  return count;
}

/**
 * Calculates bonus Coin rewarded for a multi-source combo kill.
 * 2x -> 15g, 3x -> 40g, 4x -> 80g, 5x+ -> 130g+
 */
export function computeComboBonusCoin(comboCount: number): number {
  if (comboCount < 2) return 0;
  return Math.round(15 * (comboCount - 1) + 5 * (comboCount - 1) * (comboCount - 2));
}

/**
 * Finds the nearest live Barricade within `maxRange` tiles of an enemy (used by Sapper AI).
 */
export function findNearestBarricade(
  enemy: Enemy,
  traps: ReadonlyArray<PlacedTrap>,
  maxRange: number
): PlacedTrap | null {
  let best: PlacedTrap | null = null;
  let bestDist = maxRange;

  for (const t of traps) {
    if (t.kind !== 'barricade' || t.hp <= 0) continue;
    const d = Math.hypot(t.gx + 0.5 - enemy.gx, t.gy + 0.5 - enemy.gy);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}
