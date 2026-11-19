import { Cell, GridPos, MapDefinition, TileType } from './types';

export const MAPS: MapDefinition[] = [
  {
    id: 'sunken-hallway',
    name: 'The Sunken Hallway',
    subtitle: 'Twin stone bridges flank a molten trench. Funnel with Barricades and dunk Orks into Lava.',
    difficulty: 'Apprentice',
    startingCoin: 1400,
    maxRiftPoints: 20,
    heroStart: { gx: 6, gy: 8 },
    layout: [
      '##############',
      '##..S......###',
      '##....##....##',
      '##..#LL#....##',
      '##..LLLL..####',
      '##..LLLL..####',
      '##..........##',
      '###...##..LL##',
      '###.......LL##',
      '#####....R.###',
      '##############',
    ],
    arches: [
      { gx: 3, gy: 5 },
      { gx: 8, gy: 5 },
      { gx: 5, gy: 6 },
      { gx: 8, gy: 8 },
    ],
    torches: [
      { gx: 2, gy: 0, face: 'sw' },
      { gx: 6, gy: 0, face: 'sw' },
      { gx: 1, gy: 4, face: 'se' },
      { gx: 6, gy: 7, face: 'sw' },
      { gx: 7, gy: 2, face: 'se' },
    ],
    waves: [
      {
        title: 'Wave 1 — Scouting Party',
        bonusCoin: 300,
        groups: [
          { kind: 'grunt', count: 7, interval: 1.05, delay: 0.4 },
          { kind: 'grunt', count: 5, interval: 0.85, delay: 9.0 },
        ],
      },
      {
        title: 'Wave 2 — Kobold Rush',
        bonusCoin: 360,
        groups: [
          { kind: 'grunt', count: 6, interval: 0.9, delay: 0.4 },
          { kind: 'kobold', count: 10, interval: 0.48, delay: 4.5 },
          { kind: 'grunt', count: 6, interval: 0.8, delay: 11.0 },
        ],
      },
      {
        title: 'Wave 3 — Sappers & Shields',
        bonusCoin: 420,
        groups: [
          { kind: 'grunt', count: 8, interval: 0.8, delay: 0.3 },
          { kind: 'sapper', count: 2, interval: 3.2, delay: 3.2 },
          { kind: 'brute', count: 3, interval: 2.2, delay: 7.0 },
          { kind: 'kobold', count: 8, interval: 0.45, delay: 12.5 },
        ],
      },
      {
        title: 'Wave 4 — Iron Vanguard',
        bonusCoin: 500,
        groups: [
          { kind: 'brute', count: 4, interval: 1.9, delay: 0.4 },
          { kind: 'grunt', count: 10, interval: 0.65, delay: 2.0 },
          { kind: 'sapper', count: 3, interval: 2.8, delay: 6.5 },
          { kind: 'ogre', count: 1, interval: 1.0, delay: 10.5 },
          { kind: 'kobold', count: 10, interval: 0.4, delay: 14.0 },
        ],
      },
      {
        title: 'Wave 5 — Siege of the Sunken Hall',
        bonusCoin: 650,
        groups: [
          { kind: 'kobold', count: 12, interval: 0.38, delay: 0.3 },
          { kind: 'brute', count: 5, interval: 1.7, delay: 2.8 },
          { kind: 'sapper', count: 4, interval: 2.6, delay: 5.5 },
          { kind: 'ogre', count: 2, interval: 6.5, delay: 9.0 },
          { kind: 'grunt', count: 14, interval: 0.55, delay: 11.5 },
        ],
      },
    ],
  },
  {
    id: 'twin-gates-bastion',
    name: 'Twin Gates Bastion',
    subtitle: 'Two War Portals converge on a lava-ringed courtyard. Hold both flanks with Blink & killboxes.',
    difficulty: 'Warmage',
    startingCoin: 1750,
    maxRiftPoints: 20,
    heroStart: { gx: 8, gy: 7 },
    layout: [
      '###############',
      '#####..S..#####',
      '#####.....#####',
      '####..###..####',
      '##....LLL....##',
      '#S....LLL....##',
      '#............##',
      '##..#.....#..##',
      '###...#L#...###',
      '####...L...R.##',
      '####........###',
      '###############',
    ],
    arches: [
      { gx: 5, gy: 6 },
      { gx: 9, gy: 6 },
      { gx: 7, gy: 7 },
      { gx: 11, gy: 7 },
      { gx: 8, gy: 10 },
    ],
    torches: [
      { gx: 6, gy: 0, face: 'sw' },
      { gx: 8, gy: 0, face: 'sw' },
      { gx: 0, gy: 5, face: 'se' },
      { gx: 4, gy: 7, face: 'se' },
      { gx: 10, gy: 7, face: 'sw' },
      { gx: 6, gy: 8, face: 'sw' },
    ],
    waves: [
      {
        title: 'Wave 1 — Twin Probes',
        bonusCoin: 340,
        groups: [
          { kind: 'grunt', count: 6, interval: 1.0, delay: 0.4, spawnIndex: 0 },
          { kind: 'grunt', count: 6, interval: 1.0, delay: 1.8, spawnIndex: 1 },
        ],
      },
      {
        title: 'Wave 2 — Pincer Sprint',
        bonusCoin: 400,
        groups: [
          { kind: 'kobold', count: 8, interval: 0.45, delay: 0.4, spawnIndex: 0 },
          { kind: 'grunt', count: 8, interval: 0.85, delay: 1.2, spawnIndex: 1 },
          { kind: 'kobold', count: 8, interval: 0.45, delay: 8.0, spawnIndex: 1 },
        ],
      },
      {
        title: 'Wave 3 — Powder Kegs',
        bonusCoin: 460,
        groups: [
          { kind: 'brute', count: 3, interval: 2.1, delay: 0.4, spawnIndex: 0 },
          { kind: 'sapper', count: 2, interval: 3.0, delay: 2.5, spawnIndex: 1 },
          { kind: 'grunt', count: 10, interval: 0.7, delay: 3.0 },
          { kind: 'sapper', count: 2, interval: 3.0, delay: 10.0, spawnIndex: 0 },
        ],
      },
      {
        title: 'Wave 4 — Heavy Breakers',
        bonusCoin: 520,
        groups: [
          { kind: 'ogre', count: 1, interval: 1.0, delay: 0.8, spawnIndex: 0 },
          { kind: 'grunt', count: 12, interval: 0.65, delay: 1.5 },
          { kind: 'brute', count: 4, interval: 1.8, delay: 5.0, spawnIndex: 1 },
          { kind: 'kobold', count: 12, interval: 0.4, delay: 11.0 },
        ],
      },
      {
        title: 'Wave 5 — Coordinated Assault',
        bonusCoin: 580,
        groups: [
          { kind: 'sapper', count: 3, interval: 2.6, delay: 0.5, spawnIndex: 0 },
          { kind: 'sapper', count: 3, interval: 2.6, delay: 2.0, spawnIndex: 1 },
          { kind: 'brute', count: 5, interval: 1.7, delay: 4.0 },
          { kind: 'ogre', count: 1, interval: 1.0, delay: 9.0, spawnIndex: 1 },
          { kind: 'kobold', count: 14, interval: 0.35, delay: 13.0 },
        ],
      },
      {
        title: 'Wave 6 — Twin Titans',
        bonusCoin: 650,
        groups: [
          { kind: 'ogre', count: 1, interval: 1.0, delay: 0.6, spawnIndex: 0 },
          { kind: 'ogre', count: 1, interval: 1.0, delay: 3.5, spawnIndex: 1 },
          { kind: 'grunt', count: 16, interval: 0.55, delay: 2.0 },
          { kind: 'sapper', count: 4, interval: 2.5, delay: 7.5 },
          { kind: 'brute', count: 5, interval: 1.6, delay: 11.0 },
        ],
      },
      {
        title: 'Wave 7 — Warlord Onslaught',
        bonusCoin: 800,
        groups: [
          { kind: 'kobold', count: 16, interval: 0.34, delay: 0.3 },
          { kind: 'brute', count: 6, interval: 1.5, delay: 2.5 },
          { kind: 'sapper', count: 5, interval: 2.4, delay: 5.0 },
          { kind: 'ogre', count: 3, interval: 5.5, delay: 8.0 },
          { kind: 'grunt', count: 18, interval: 0.45, delay: 10.5 },
        ],
      },
    ],
  },
];

export interface ParsedMap {
  definition: MapDefinition;
  rows: number;
  cols: number;
  grid: Cell[][];
  spawns: GridPos[];
  rifts: GridPos[];
}

export function parseMap(def: MapDefinition): ParsedMap {
  const rows = def.layout.length;
  const cols = def.layout[0].length;
  const archSet = new Set(def.arches.map((a) => `${a.gx},${a.gy}`));
  const torchMap = new Map(def.torches.map((t) => [`${t.gx},${t.gy}`, t.face]));

  const spawns: GridPos[] = [];
  const rifts: GridPos[] = [];
  const grid: Cell[][] = [];

  for (let gy = 0; gy < rows; gy++) {
    const rowStr = def.layout[gy];
    const row: Cell[] = [];
    for (let gx = 0; gx < cols; gx++) {
      const ch = rowStr[gx] ?? ' ';
      let type: TileType = 'void';
      switch (ch) {
        case '#':
          type = 'wall';
          break;
        case '.':
          type = 'floor';
          break;
        case 'L':
          type = 'lava';
          break;
        case 'S':
          type = 'spawn';
          spawns.push({ gx, gy });
          break;
        case 'R':
          type = 'rift';
          rifts.push({ gx, gy });
          break;
        default:
          type = 'void';
      }

      // Deterministic tile visual variant hash
      const variant = ((gx * 37 + gy * 17) ^ (gx * 13)) & 3;
      const key = `${gx},${gy}`;
      row.push({
        gx,
        gy,
        type,
        hasArch: archSet.has(key) && type === 'floor',
        variant,
        torch: torchMap.get(key),
      });
    }
    grid.push(row);
  }

  return { definition: def, rows, cols, grid, spawns, rifts };
}
