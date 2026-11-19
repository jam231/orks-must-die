export type TileType = 'void' | 'floor' | 'wall' | 'lava' | 'spawn' | 'rift';

export type WallFace = 'se' | 'sw';

export type CardinalDir = 'se' | 'sw' | 'nw' | 'ne';

export interface GridPos {
  gx: number;
  gy: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Cell {
  gx: number;
  gy: number;
  type: TileType;
  hasArch: boolean;
  variant: number;
  torch?: WallFace;
}

export type TrapKind =
  | 'barricade'
  | 'tar'
  | 'spikes'
  | 'arrow_wall'
  | 'flip'
  | 'pounder';

export type TrapSurface = 'blocker' | 'floor' | 'wall' | 'ceiling';

export interface TrapSpec {
  kind: TrapKind;
  name: string;
  shortName: string;
  surface: TrapSurface;
  cost: number;
  hotkey: string;
  cooldown: number;
  damage: number;
  description: string;
  accentColor: string;
}

export interface PlacedTrap {
  id: number;
  kind: TrapKind;
  gx: number;
  gy: number;
  wallFace?: WallFace;
  facing: CardinalDir;
  cooldownTimer: number;
  activeAnim: number; // 0..1 visual trigger pulse
  hp: number;
  maxHp: number;
  placedDuringPrep: boolean;
  totalKills: number;
  totalDamage: number;
}

export type EnemyKind = 'grunt' | 'kobold' | 'sapper' | 'brute' | 'ogre';

export interface EnemySpec {
  kind: EnemyKind;
  name: string;
  maxHp: number;
  speed: number; // tiles per second
  coinReward: number;
  riftCost: number;
  radius: number; // in grid tile units
  height: number; // visual height in px
  armorFront: number; // 0..1 damage reduction vs frontal bolts
  flipImmune: boolean;
  barricadeDamage: number;
}

export interface ComboEntry {
  source: string;
  time: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  gx: number;
  gy: number;
  z: number; // vertical height in world px (>0 when airborne)
  vx: number; // grid units / sec (knockback velocity)
  vy: number;
  vz: number; // px / sec
  facingX: number;
  facingY: number;
  hp: number;
  maxHp: number;
  tarTimer: number;
  freezeTimer: number;
  staggerTimer: number;
  hitFlash: number;
  walkPhase: number;
  airborne: boolean;
  launchedByTrapId?: number;
  targetBarricadeId?: number;
  attackCooldown: number;
  fuseTimer: number; // Sapper detonation telegraph
  comboTags: ComboEntry[];
  dead: boolean;
  deathCause?: 'normal' | 'lava' | 'rift' | 'sapper_self';
}

export interface Hero {
  gx: number;
  gy: number;
  z: number;
  vx: number;
  vy: number;
  facingX: number;
  facingY: number;
  moveSpeed: number;
  attackRange: number;
  attackCooldown: number;
  attackInterval: number;
  attackDamage: number;
  targetEnemyId: number | null;
  blastCooldown: number;
  blastMaxCooldown: number;
  frostCooldown: number;
  frostMaxCooldown: number;
  dashCooldown: number;
  dashMaxCooldown: number;
  dashTimer: number;
  dashDirX: number;
  dashDirY: number;
  walkPhase: number;
  recoilAnim: number;
  castAnim: number;
}

export type ProjectileKind = 'hero_bolt' | 'wall_arrow';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  gx: number;
  gy: number;
  z: number;
  vx: number;
  vy: number;
  damage: number;
  life: number;
  pierceLeft: number;
  hitIds: Set<number>;
  sourceTag: string;
  trapId?: number;
}

export interface Particle {
  gx: number;
  gy: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  glow?: boolean;
}

export interface RingEffect {
  gx: number;
  gy: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: string;
  kind: 'frost' | 'blast' | 'explosion' | 'rift' | 'pounder' | 'dash';
  dirX?: number;
  dirY?: number;
}

export interface FloatingText {
  gx: number;
  gy: number;
  z: number;
  text: string;
  color: string;
  scale: number;
  life: number;
  maxLife: number;
  vy: number;
}

export interface WaveSpawnGroup {
  kind: EnemyKind;
  count: number;
  interval: number;
  delay: number;
  spawnIndex?: number; // which spawn gate (defaults to alternating)
}

export interface WaveDefinition {
  title: string;
  bonusCoin: number;
  groups: WaveSpawnGroup[];
}

export interface MapDefinition {
  id: string;
  name: string;
  subtitle: string;
  difficulty: 'Apprentice' | 'Warmage';
  startingCoin: number;
  maxRiftPoints: number;
  heroStart: GridPos;
  layout: string[];
  arches: GridPos[];
  torches: Array<{ gx: number; gy: number; face: WallFace }>;
  waves: WaveDefinition[];
}

export type GamePhase = 'title' | 'prep' | 'wave' | 'victory' | 'defeat';

export interface CameraState {
  x: number; // world iso center x
  y: number; // world iso center y
  zoom: number;
  minZoom: number;
  maxZoom: number;
  followHero: boolean;
  shakeTime: number;
  shakeIntensity: number;
}

export interface PlacementHover {
  gx: number;
  gy: number;
  wallFace?: WallFace;
  valid: boolean;
  reason?: string;
  facing?: CardinalDir;
}

export interface RunStats {
  orksSlain: number;
  lavaKills: number;
  highestCombo: number;
  totalComboBonus: number;
  trapsPlaced: number;
  barricadesLost: number;
  elapsedSeconds: number;
}

export const ISO_TILE_W = 88;
export const ISO_TILE_H = 44;
export const ISO_WALL_H = 48;

export const CARDINAL_VECTORS: Record<CardinalDir, { dx: number; dy: number }> = {
  se: { dx: 1, dy: 0 },
  sw: { dx: 0, dy: 1 },
  nw: { dx: -1, dy: 0 },
  ne: { dx: 0, dy: -1 },
};

export const CARDINAL_ORDER: CardinalDir[] = ['se', 'sw', 'nw', 'ne'];

export const TRAP_SPECS: Record<TrapKind, TrapSpec> = {
  barricade: {
    kind: 'barricade',
    name: 'Oak Barricade',
    shortName: 'Barricade',
    surface: 'blocker',
    cost: 400,
    hotkey: '1',
    cooldown: 0,
    damage: 0,
    description: 'Reroutes Orks into killboxes. Guard against Sappers!',
    accentColor: '#c98a4b',
  },
  tar: {
    kind: 'tar',
    name: 'Tar Pit',
    shortName: 'Tar',
    surface: 'floor',
    cost: 200,
    hotkey: '2',
    cooldown: 0,
    damage: 0,
    description: 'Slows Orks by 55% and adds a Combo stack.',
    accentColor: '#5c6b78',
  },
  spikes: {
    kind: 'spikes',
    name: 'Floor Spikes',
    shortName: 'Spikes',
    surface: 'floor',
    cost: 300,
    hotkey: '3',
    cooldown: 3.4,
    damage: 78,
    description: 'Bursts upward to impale Orks stepping over it.',
    accentColor: '#d96b43',
  },
  arrow_wall: {
    kind: 'arrow_wall',
    name: 'Arrow Wall',
    shortName: 'Arrows',
    surface: 'wall',
    cost: 450,
    hotkey: '4',
    cooldown: 3.1,
    damage: 46,
    description: 'Mounts on walls; fires a 5-bolt piercing volley across the lane.',
    accentColor: '#e2a83b',
  },
  flip: {
    kind: 'flip',
    name: 'Spring Flip',
    shortName: 'Flip',
    surface: 'floor',
    cost: 500,
    hotkey: '5',
    cooldown: 4.5,
    damage: 24,
    description: 'Launches Orks airborne into Lava! Tap placed trap to rotate.',
    accentColor: '#48b89f',
  },
  pounder: {
    kind: 'pounder',
    name: 'Ceiling Pounder',
    shortName: 'Pounder',
    surface: 'ceiling',
    cost: 600,
    hotkey: '6',
    cooldown: 3.8,
    damage: 135,
    description: 'Mounts under stone archways; slams down for massive AoE stun.',
    accentColor: '#e05845',
  },
};

export const TRAP_ORDER: TrapKind[] = [
  'barricade',
  'tar',
  'spikes',
  'arrow_wall',
  'flip',
  'pounder',
];

export const ENEMY_SPECS: Record<EnemyKind, EnemySpec> = {
  grunt: {
    kind: 'grunt',
    name: 'Ork Grunt',
    maxHp: 115,
    speed: 1.55,
    coinReward: 38,
    riftCost: 1,
    radius: 0.28,
    height: 36,
    armorFront: 0,
    flipImmune: false,
    barricadeDamage: 16,
  },
  kobold: {
    kind: 'kobold',
    name: 'Kobold Runner',
    maxHp: 58,
    speed: 2.85,
    coinReward: 30,
    riftCost: 1,
    radius: 0.21,
    height: 26,
    armorFront: 0,
    flipImmune: false,
    barricadeDamage: 10,
  },
  sapper: {
    kind: 'sapper',
    name: 'Ork Sapper',
    maxHp: 90,
    speed: 2.15,
    coinReward: 65,
    riftCost: 1,
    radius: 0.26,
    height: 32,
    armorFront: 0,
    flipImmune: false,
    barricadeDamage: 240,
  },
  brute: {
    kind: 'brute',
    name: 'Shielded Brute',
    maxHp: 250,
    speed: 1.2,
    coinReward: 75,
    riftCost: 2,
    radius: 0.34,
    height: 44,
    armorFront: 0.55,
    flipImmune: false,
    barricadeDamage: 28,
  },
  ogre: {
    kind: 'ogre',
    name: 'Armored Ogre',
    maxHp: 780,
    speed: 0.92,
    coinReward: 220,
    riftCost: 5,
    radius: 0.42,
    height: 58,
    armorFront: 0.25,
    flipImmune: true,
    barricadeDamage: 75,
  },
};
