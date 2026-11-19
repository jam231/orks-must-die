import { AssetAtlas, SpriteEntry } from './assets';
import {
  computeMapWorldBounds,
  getTileDiamond,
  getWallFaceQuad,
  gridToIso,
  worldToScreen,
} from './iso';
import { GameSimulation } from './simulation';
import { isValidWallTrapFace } from './traps';
import {
  CARDINAL_VECTORS,
  Cell,
  ENEMY_SPECS,
  Enemy,
  EnemyKind,
  GridPos,
  ISO_TILE_H,
  ISO_TILE_W,
  ISO_WALL_H,
  PlacedTrap,
  Projectile,
  TRAP_SPECS,
  Vec2,
  WallFace,
} from './types';

export interface JoystickVisualState {
  active: boolean;
  originX: number;
  originY: number;
  knobX: number;
  knobY: number;
  radius: number;
}

interface DepthDrawable {
  depth: number;
  layer: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

interface CachedWallSprite {
  canvas: HTMLCanvasElement;
  anchorX: number; // pixel x corresponding to tile center iso x
  anchorY: number; // pixel y corresponding to tile ground center iso y
}

const ENEMY_SPRITE_HEIGHT: Record<EnemyKind, number> = {
  kobold: 48,
  grunt: 64,
  sapper: 66,
  brute: 74,
  ogre: 100,
};

export class IsoRenderer {
  public atlas: AssetAtlas;

  private floorCache: HTMLCanvasElement[] = [];
  private wallFullCache: CachedWallSprite[] = [];
  private wallCutawayCache: CachedWallSprite[] = [];
  private lavaFrames: HTMLCanvasElement[] = [];

  // Pre-baked whole-map static floor + AO canvas (1 drawImage per frame!)
  private groundMapCanvas: HTMLCanvasElement | null = null;
  private groundMapOriginX = 0;
  private groundMapOriginY = 0;
  private groundMapId = '';
  private groundMapAtlasReady = false;

  // Pre-baked reusable glow stamps (zero per-frame createRadialGradient allocations!)
  private glowAmber: HTMLCanvasElement | null = null;
  private glowLava: HTMLCanvasElement | null = null;
  private glowCyan: HTMLCanvasElement | null = null;
  private glowCrimson: HTMLCanvasElement | null = null;
  private decalScorch: HTMLCanvasElement | null = null;
  private decalFrost: HTMLCanvasElement | null = null;

  constructor() {
    this.atlas = new AssetAtlas();
    if (typeof document !== 'undefined') {
      this.buildGlowStamps();
      this.rebuildTileCaches();
      this.atlas.onLoaded = () => {
        this.rebuildTileCaches();
        this.groundMapId = ''; // Force static floor layer rebake with painterly textures
      };
      this.atlas.loadAll();
    }
  }

  private buildGlowStamps(): void {
    const makeGlow = (
      size: number,
      stops: Array<[number, string]>
    ): HTMLCanvasElement => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d');
      if (g) {
        const half = size * 0.5;
        const grad = g.createRadialGradient(half, half, 0, half, half, half);
        for (const [offset, col] of stops) {
          grad.addColorStop(offset, col);
        }
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
      }
      return c;
    };

    this.glowAmber = makeGlow(128, [
      [0, 'rgba(255, 210, 120, 0.55)'],
      [0.4, 'rgba(255, 148, 48, 0.24)'],
      [1, 'rgba(255, 110, 20, 0)'],
    ]);
    this.glowLava = makeGlow(128, [
      [0, 'rgba(255, 175, 64, 0.42)'],
      [0.45, 'rgba(255, 86, 22, 0.20)'],
      [1, 'rgba(200, 36, 8, 0)'],
    ]);
    this.glowCyan = makeGlow(128, [
      [0, 'rgba(155, 252, 255, 0.62)'],
      [0.4, 'rgba(56, 214, 245, 0.26)'],
      [1, 'rgba(20, 140, 210, 0)'],
    ]);
    this.glowCrimson = makeGlow(128, [
      [0, 'rgba(255, 108, 52, 0.50)'],
      [0.5, 'rgba(195, 36, 20, 0.20)'],
      [1, 'rgba(140, 16, 12, 0)'],
    ]);
    this.decalScorch = makeGlow(96, [
      [0, 'rgba(10, 8, 8, 0.78)'],
      [0.6, 'rgba(42, 22, 14, 0.42)'],
      [1, 'rgba(10, 8, 8, 0)'],
    ]);
    this.decalFrost = makeGlow(96, [
      [0, 'rgba(180, 248, 255, 0.36)'],
      [0.7, 'rgba(88, 212, 245, 0.18)'],
      [1, 'rgba(88, 212, 245, 0)'],
    ]);
  }

  private rebuildTileCaches(): void {
    this.buildFloorCache(this.atlas.texStoneFloor);
    this.wallFullCache = [
      this.bakeWallSprite(ISO_WALL_H, 0),
      this.bakeWallSprite(ISO_WALL_H, 1),
    ];
    this.wallCutawayCache = [
      this.bakeWallSprite(16, 0),
      this.bakeWallSprite(16, 1),
    ];
    this.buildLavaFrames(this.atlas.texMoltenLava);
  }

  private buildFloorCache(stoneTex: HTMLImageElement | null): void {
    this.floorCache = [];
    const pad = 4;
    const w = ISO_TILE_W + pad * 2;
    const h = ISO_TILE_H + pad * 2;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const hw = ISO_TILE_W * 0.5;
    const hh = ISO_TILE_H * 0.5;

    const baseShades = ['#464c58', '#414752', '#4b515e', '#3e444f'];
    const cropOffsets = [
      [0, 0],
      [180, 90],
      [90, 210],
      [250, 240],
    ];

    for (let v = 0; v < 4; v++) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      if (!g) continue;

      g.beginPath();
      g.moveTo(cx, cy - hh);
      g.lineTo(cx + hw, cy);
      g.lineTo(cx, cy + hh);
      g.lineTo(cx - hw, cy);
      g.closePath();

      if (stoneTex) {
        g.save();
        g.clip();
        const [sx, sy] = cropOffsets[v];
        const cropSize = 210;
        g.translate(cx, cy);
        g.scale(1, 0.5);
        g.rotate(Math.PI / 4);
        const drawSpan = ISO_TILE_W * 0.78;
        g.drawImage(
          stoneTex,
          sx,
          sy,
          cropSize,
          cropSize,
          -drawSpan * 0.5,
          -drawSpan * 0.5,
          drawSpan,
          drawSpan
        );
        g.restore();

        // Balanced cool slate glaze so traps & characters stay super readable
        g.fillStyle = v % 2 === 0 ? 'rgba(30, 38, 52, 0.24)' : 'rgba(22, 28, 40, 0.30)';
        g.fill();
      } else {
        const grad = g.createLinearGradient(cx - hw, cy - hh, cx + hw, cy + hh);
        grad.addColorStop(0, '#555c6b');
        grad.addColorStop(0.5, baseShades[v]);
        grad.addColorStop(1, '#303540');
        g.fillStyle = grad;
        g.fill();
      }

      // Warm stone top bevel
      g.strokeStyle = 'rgba(242, 232, 214, 0.20)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(cx - hw + 1.5, cy);
      g.lineTo(cx, cy - hh + 1.2);
      g.lineTo(cx + hw - 1.5, cy);
      g.stroke();

      // Deep mortar seam
      g.strokeStyle = 'rgba(10, 12, 16, 0.65)';
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(cx, cy - hh);
      g.lineTo(cx + hw, cy);
      g.lineTo(cx, cy + hh);
      g.lineTo(cx - hw, cy);
      g.closePath();
      g.stroke();

      this.floorCache.push(c);
    }
  }

  /**
   * Pre-bakes a complete isometric masonry wall block (SW sheared brick face, SE sheared brick face,
   * textured stone parapet top, and crisp bevel edges) onto an offscreen sprite.
   * Eliminates ~250 per-frame ctx.clip() + CanvasPattern + gradient calls!
   */
  private bakeWallSprite(wallH: number, variant: number): CachedWallSprite {
    const pad = 6;
    const w = ISO_TILE_W + pad * 2;
    const h = ISO_TILE_H + wallH + pad * 2;
    const anchorX = w * 0.5;
    const anchorY = pad + wallH + ISO_TILE_H * 0.5;

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return { canvas: c, anchorX, anchorY };

    const hw = ISO_TILE_W * 0.5;
    const hh = ISO_TILE_H * 0.5;

    // Ground diamond corners relative to (anchorX, anchorY)
    const bTop = { x: anchorX, y: anchorY - hh };
    const bRight = { x: anchorX + hw, y: anchorY };
    const bBot = { x: anchorX, y: anchorY + hh };
    const bLeft = { x: anchorX - hw, y: anchorY };

    // Top diamond corners extruded upward by wallH
    const tTop = { x: bTop.x, y: bTop.y - wallH };
    const tRight = { x: bRight.x, y: bRight.y - wallH };
    const tBot = { x: bBot.x, y: bBot.y - wallH };
    const tLeft = { x: bLeft.x, y: bLeft.y - wallH };

    const topD: Vec2[] = [tTop, tRight, tBot, tLeft];
    const swQuad: Vec2[] = [tLeft, tBot, bBot, bLeft];
    const seQuad: Vec2[] = [tRight, tBot, bBot, bRight];

    const wallPat = this.atlas.texWallMasonry
      ? g.createPattern(this.atlas.texWallMasonry, 'repeat')
      : null;
    const floorPat = this.atlas.texStoneFloor
      ? g.createPattern(this.atlas.texStoneFloor, 'repeat')
      : null;
    const texShift = variant * 110;

    // SW face (left side — deeper dungeon shadow)
    g.save();
    this.tracePoly(g, swQuad);
    g.clip();
    if (wallPat) {
      g.save();
      g.translate(tLeft.x, tLeft.y);
      g.transform(1, 0.5, 0, 1, 0, 0);
      g.scale(0.18, 0.18);
      g.translate(-texShift, 0);
      g.fillStyle = wallPat;
      g.fillRect(texShift - 40, -40, 420, 420);
      g.restore();
      const swShade = g.createLinearGradient(tLeft.x, tLeft.y, bBot.x, bBot.y);
      swShade.addColorStop(0, 'rgba(18, 22, 34, 0.42)');
      swShade.addColorStop(1, 'rgba(8, 10, 16, 0.66)');
      g.fillStyle = swShade;
      g.fill();
    } else {
      const swGrad = g.createLinearGradient(tLeft.x, tLeft.y, bBot.x, bBot.y);
      swGrad.addColorStop(0, '#363b45');
      swGrad.addColorStop(1, '#20242c');
      this.fillPoly(g, swQuad, swGrad);
    }
    g.restore();

    // SE face (right side — warmer torchlit midtone)
    g.save();
    this.tracePoly(g, seQuad);
    g.clip();
    if (wallPat) {
      g.save();
      g.translate(tRight.x, tRight.y);
      g.transform(1, -0.5, 0, 1, 0, 0);
      g.scale(0.18, 0.18);
      g.translate(-texShift, 0);
      g.fillStyle = wallPat;
      g.fillRect(texShift - 40, -40, 420, 420);
      g.restore();
      const seShade = g.createLinearGradient(tRight.x, tRight.y, bBot.x, bBot.y);
      seShade.addColorStop(0, 'rgba(30, 34, 44, 0.18)');
      seShade.addColorStop(1, 'rgba(12, 14, 22, 0.46)');
      g.fillStyle = seShade;
      g.fill();
    } else {
      const seGrad = g.createLinearGradient(tRight.x, tRight.y, bBot.x, bBot.y);
      seGrad.addColorStop(0, '#4a505e');
      seGrad.addColorStop(1, '#2c303a');
      this.fillPoly(g, seQuad, seGrad);
    }
    g.restore();

    // Top stone parapet cap
    g.save();
    this.tracePoly(g, topD);
    g.clip();
    if (floorPat) {
      g.save();
      g.translate(anchorX, anchorY - wallH);
      g.scale(0.24, 0.12);
      g.rotate(Math.PI / 4);
      g.translate(texShift * 0.5, -texShift * 0.3);
      g.fillStyle = floorPat;
      g.fillRect(-300, -300, 600, 600);
      g.restore();
      g.fillStyle =
        wallH < ISO_WALL_H ? 'rgba(26, 30, 42, 0.38)' : 'rgba(66, 76, 96, 0.18)';
      g.fill();
    } else {
      const capGrad = g.createLinearGradient(tLeft.x, tTop.y, tRight.x, tBot.y);
      capGrad.addColorStop(0, wallH < ISO_WALL_H ? '#4c525f' : '#626978');
      capGrad.addColorStop(1, wallH < ISO_WALL_H ? '#373c46' : '#474d5a');
      this.fillPoly(g, topD, capGrad);
    }
    g.restore();

    // Crisp stone rim highlight & dark seams
    g.strokeStyle = 'rgba(238, 232, 222, 0.24)';
    g.lineWidth = 1.25;
    g.beginPath();
    g.moveTo(tLeft.x, tLeft.y);
    g.lineTo(tTop.x, tTop.y);
    g.lineTo(tRight.x, tRight.y);
    g.stroke();

    g.strokeStyle = 'rgba(10, 12, 16, 0.72)';
    g.lineWidth = 1.3;
    this.strokePoly(g, swQuad);
    this.strokePoly(g, seQuad);

    return { canvas: c, anchorX, anchorY };
  }

  /**
   * Pre-bakes 6 looping frames of scrolling painterly molten lava tiles (zero per-frame clip/pattern).
   */
  private buildLavaFrames(lavaTex: HTMLImageElement | null): void {
    this.lavaFrames = [];
    const pad = 4;
    const w = ISO_TILE_W + pad * 2;
    const h = ISO_TILE_H + pad * 2;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const hw = ISO_TILE_W * 0.5;
    const hh = ISO_TILE_H * 0.5;
    const frameCount = 6;

    for (let f = 0; f < frameCount; f++) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      if (!g) continue;

      const d: Vec2[] = [
        { x: cx, y: cy - hh },
        { x: cx + hw, y: cy },
        { x: cx, y: cy + hh },
        { x: cx - hw, y: cy },
      ];
      const pulse = 0.5 + 0.5 * Math.sin((f / frameCount) * Math.PI * 2);

      g.save();
      this.tracePoly(g, d);
      g.clip();

      if (lavaTex) {
        const pat = g.createPattern(lavaTex, 'repeat');
        if (pat) {
          g.save();
          const drift = (f / frameCount) * 512;
          g.scale(0.35, 0.19);
          g.translate(drift, drift * 0.5);
          g.fillStyle = pat;
          g.fillRect(-drift - 200, -drift * 0.5 - 200, 900, 900);
          g.restore();
        }
        const glow = g.createRadialGradient(cx, cy, 3, cx, cy, ISO_TILE_W * 0.5);
        glow.addColorStop(0, `rgba(255, 224, 110, ${0.22 + 0.16 * pulse})`);
        glow.addColorStop(0.55, `rgba(255, 110, 30, ${0.14 + 0.08 * pulse})`);
        glow.addColorStop(1, 'rgba(32, 8, 4, 0.44)');
        g.fillStyle = glow;
        g.fill();
      } else {
        const grad = g.createRadialGradient(cx, cy, 4, cx, cy, ISO_TILE_W * 0.52);
        grad.addColorStop(0, pulse > 0.5 ? '#ffe066' : '#ffbd45');
        grad.addColorStop(0.45, '#f25c19');
        grad.addColorStop(0.88, '#9e2108');
        grad.addColorStop(1, '#3d0c05');
        this.fillPoly(g, d, grad);
      }

      // Recessed stone drop lip
      g.strokeStyle = '#1f1614';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(d[3].x, d[3].y);
      g.lineTo(d[0].x, d[0].y);
      g.lineTo(d[1].x, d[1].y);
      g.stroke();

      g.strokeStyle = 'rgba(255, 152, 56, 0.36)';
      g.lineWidth = 1.4;
      this.strokePoly(g, d);
      g.restore();

      this.lavaFrames.push(c);
    }
  }

  /**
   * Bakes the entire static floor layer (all flagstones + wall-base AO shadows + arch outlines)
   * onto a single offscreen canvas once per map load!
   */
  private ensureStaticGroundMap(sim: GameSimulation): void {
    if (
      this.groundMapCanvas &&
      this.groundMapId === sim.map.definition.id &&
      this.groundMapAtlasReady === this.atlas.ready
    ) {
      return;
    }

    const { grid, rows, cols } = sim.map;
    const bounds = computeMapWorldBounds(rows, cols);
    const pad = 64;
    const width = Math.ceil(bounds.maxX - bounds.minX + pad * 2);
    const height = Math.ceil(bounds.maxY - bounds.minY + pad * 2);
    const originX = -bounds.minX + pad;
    const originY = -bounds.minY + pad;

    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const g = c.getContext('2d');
    if (!g) return;

    g.translate(originX, originY);

    for (let sum = 0; sum <= rows + cols - 2; sum++) {
      for (let gy = 0; gy < rows; gy++) {
        const gx = sum - gy;
        if (gx < 0 || gx >= cols) continue;
        const cell = grid[gy][gx];
        if (cell.type === 'void' || cell.type === 'wall' || cell.type === 'lava') continue;

        const center = gridToIso(cell.gx + 0.5, cell.gy + 0.5, 0);
        const cached = this.floorCache[cell.variant % this.floorCache.length];
        if (cached) {
          g.drawImage(cached, center.x - cached.width * 0.5, center.y - cached.height * 0.5);
        }

        if (cell.hasArch) {
          const d = this.insetDiamond(getTileDiamond(cell.gx, cell.gy, 0), 0.08);
          g.save();
          g.strokeStyle = 'rgba(235, 186, 98, 0.42)';
          g.lineWidth = 1.6;
          g.setLineDash([5, 4]);
          this.strokePoly(g, d);
          g.restore();
        }

        this.drawWallBaseAO(g, grid, rows, cols, gx, gy);
      }
    }

    this.groundMapCanvas = c;
    this.groundMapOriginX = originX;
    this.groundMapOriginY = originY;
    this.groundMapId = sim.map.definition.id;
    this.groundMapAtlasReady = this.atlas.ready;
  }

  public render(
    ctx: CanvasRenderingContext2D,
    sim: GameSimulation,
    viewportW: number,
    viewportH: number,
    joystick: JoystickVisualState
  ): void {
    this.ensureStaticGroundMap(sim);

    // 1. Fast solid obsidian fill (zero 3M-pixel per-frame radial gradient rasterization on mobile!)
    ctx.fillStyle = '#111217';
    ctx.fillRect(0, 0, viewportW, viewportH);

    // Camera shake
    let shakeX = 0;
    let shakeY = 0;
    if (sim.camera.shakeTime > 0) {
      const mag = sim.camera.shakeIntensity * (sim.camera.shakeTime / 0.25);
      shakeX = (Math.random() - 0.5) * 2 * Math.min(10, mag);
      shakeY = (Math.random() - 0.5) * 2 * Math.min(10, mag);
    }

    ctx.save();
    ctx.translate(viewportW * 0.5 + shakeX, viewportH * 0.5 + shakeY);
    ctx.scale(sim.camera.zoom, sim.camera.zoom);
    ctx.translate(-sim.camera.x, -sim.camera.y);

    // 2. Single-drawImage pre-baked floor + wall AO layer!
    if (this.groundMapCanvas) {
      ctx.drawImage(
        this.groundMapCanvas,
        -this.groundMapOriginX,
        -this.groundMapOriginY
      );
    }

    // 3. Animated lava tiles, portals, rift runes & floor traps
    this.drawDynamicGroundElements(ctx, sim);

    // 4. Persistent battle decals
    this.drawDecals(ctx, sim);

    // 5. Live path preview chevrons
    this.drawPathPreviews(ctx, sim);

    // 6. Placement highlights & hover ghost
    this.drawPlacementOverlay(ctx, sim);

    // 7. Depth-sorted 2.5D entities (cached wall sprites, arrow walls, barricades, rift, hero, orks, projectiles)
    this.drawDepthSortedObjects(ctx, sim);

    // 8. Overhead stone archways & Ceiling Pounders
    this.drawOverheadLayer(ctx, sim);

    // 9. Spell shockwave rings & particles
    this.drawRings(ctx, sim);
    this.drawParticles(ctx, sim);

    // 10. Fast localized additive lighting & emissive glow stamps (zero full-screen multiply readback!)
    this.drawFastAdditiveLighting(ctx, sim);

    // 11. Crisp floating combat text
    this.drawFloatingTexts(ctx, sim);

    ctx.restore();

    // 12. Screen-space floating virtual joystick visual
    if (joystick.active) {
      this.drawJoystick(ctx, joystick);
    }

    // 13. Screen-space inspected trap selection ring
    if (sim.inspectedTrapId !== null) {
      const trap = sim.traps.find((t) => t.id === sim.inspectedTrapId);
      if (trap) {
        const pos = gridToIso(trap.gx + 0.5, trap.gy + 0.5, trap.wallFace ? 24 : 4);
        const screenPos = worldToScreen(pos.x, pos.y, sim.camera, viewportW, viewportH);
        ctx.save();
        ctx.strokeStyle = '#ffe07d';
        ctx.lineWidth = 2.6;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, 28 * sim.camera.zoom, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawDynamicGroundElements(
    ctx: CanvasRenderingContext2D,
    sim: GameSimulation
  ): void {
    const { grid, rows, cols } = sim.map;
    const frameCount = this.lavaFrames.length;
    const baseFrame = Math.floor(sim.time * 4.5);

    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const cell = grid[gy][gx];
        if (cell.type === 'lava' && frameCount > 0) {
          const center = gridToIso(gx + 0.5, gy + 0.5, 0);
          const sprite = this.lavaFrames[(baseFrame + gx + gy) % frameCount];
          ctx.drawImage(sprite, center.x - sprite.width * 0.5, center.y - sprite.height * 0.5);
        } else if (cell.type === 'spawn') {
          this.drawSpawnPortalGround(ctx, gx, gy, sim.time);
        } else if (cell.type === 'rift') {
          this.drawRiftGroundBase(ctx, gx, gy, sim.time);
        }
      }
    }

    // Floor traps
    for (const t of sim.traps) {
      if (TRAP_SPECS[t.kind].surface === 'floor') {
        this.drawFloorTrap(ctx, t, sim.time);
      }
    }
  }

  private drawWallBaseAO(
    ctx: CanvasRenderingContext2D,
    grid: Cell[][],
    rows: number,
    cols: number,
    gx: number,
    gy: number
  ): void {
    const wallNW = gx > 0 && grid[gy][gx - 1].type === 'wall';
    const wallNE = gy > 0 && grid[gy - 1][gx].type === 'wall';
    const wallSW = gy + 1 < rows && grid[gy + 1][gx].type === 'wall';
    const wallSE = gx + 1 < cols && grid[gy][gx + 1].type === 'wall';

    if (!wallNW && !wallNE && !wallSW && !wallSE) return;

    const d = getTileDiamond(gx, gy, 0);
    const center = gridToIso(gx + 0.5, gy + 0.5, 0);

    ctx.save();
    this.tracePoly(ctx, d);
    ctx.clip();

    if (wallNW) {
      const edgeMidX = (d[0].x + d[3].x) * 0.5;
      const edgeMidY = (d[0].y + d[3].y) * 0.5;
      const g = ctx.createLinearGradient(edgeMidX, edgeMidY, center.x + 6, center.y + 3);
      g.addColorStop(0, 'rgba(5, 7, 11, 0.56)');
      g.addColorStop(1, 'rgba(5, 7, 11, 0)');
      this.fillPoly(ctx, d, g);
    }

    if (wallNE) {
      const edgeMidX = (d[0].x + d[1].x) * 0.5;
      const edgeMidY = (d[0].y + d[1].y) * 0.5;
      const g = ctx.createLinearGradient(edgeMidX, edgeMidY, center.x - 6, center.y + 3);
      g.addColorStop(0, 'rgba(5, 7, 11, 0.50)');
      g.addColorStop(1, 'rgba(5, 7, 11, 0)');
      this.fillPoly(ctx, d, g);
    }

    if (wallSW || wallSE) {
      ctx.strokeStyle = 'rgba(5, 7, 11, 0.30)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      if (wallSW) {
        ctx.moveTo(d[3].x, d[3].y);
        ctx.lineTo(d[2].x, d[2].y);
      }
      if (wallSE) {
        ctx.moveTo(d[1].x, d[1].y);
        ctx.lineTo(d[2].x, d[2].y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawSpawnPortalGround(
    ctx: CanvasRenderingContext2D,
    gx: number,
    gy: number,
    time: number
  ): void {
    const center = gridToIso(gx + 0.5, gy + 0.5, 0);
    const pulse = 0.72 + 0.28 * Math.sin(time * 4.2);

    ctx.save();
    if (this.glowCrimson) {
      ctx.globalAlpha = pulse;
      ctx.drawImage(this.glowCrimson, center.x - 42, center.y - 22, 84, 44);
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = '#1b1414';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, 24, 12, 0, 0, Math.PI * 2);
    ctx.stroke();

    const leftPost = gridToIso(gx + 0.15, gy + 0.15, 0);
    const rightPost = gridToIso(gx + 0.85, gy + 0.15, 0);
    ctx.strokeStyle = '#363a44';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(leftPost.x, leftPost.y);
    ctx.lineTo(leftPost.x, leftPost.y - 26);
    ctx.moveTo(rightPost.x, rightPost.y);
    ctx.lineTo(rightPost.x, rightPost.y - 26);
    ctx.stroke();

    ctx.strokeStyle = '#5c4133';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(leftPost.x, leftPost.y - 25);
    ctx.quadraticCurveTo(center.x, center.y - 42, rightPost.x, rightPost.y - 25);
    ctx.stroke();
    ctx.restore();
  }

  private drawRiftGroundBase(
    ctx: CanvasRenderingContext2D,
    gx: number,
    gy: number,
    time: number
  ): void {
    const center = gridToIso(gx + 0.5, gy + 0.5, 0);
    const pulse = 0.76 + 0.24 * Math.sin(time * 3.4);

    ctx.save();
    if (this.glowCyan) {
      ctx.globalAlpha = pulse;
      ctx.drawImage(this.glowCyan, center.x - 54, center.y - 28, 108, 56);
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = 'rgba(130, 248, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -time * 24;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, 32, 16, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawRiftProp(
    ctx: CanvasRenderingContext2D,
    gx: number,
    gy: number,
    time: number
  ): void {
    const center = gridToIso(gx + 0.5, gy + 0.5, 0);
    const bob = Math.sin(time * 2.8) * 4.5;

    if (this.atlas.rift) {
      const img = this.atlas.rift;
      const drawH = 88;
      const drawW = drawH * (img.width / img.height);
      ctx.drawImage(img, center.x - drawW * 0.5, center.y - drawH + 18 + bob * 0.5, drawW, drawH);
      return;
    }

    const cy = center.y - 34 + bob;
    ctx.save();
    ctx.fillStyle = '#53e8ff';
    ctx.beginPath();
    ctx.moveTo(center.x, cy - 22);
    ctx.lineTo(center.x + 11, cy);
    ctx.lineTo(center.x, cy + 18);
    ctx.lineTo(center.x - 11, cy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawDecals(ctx: CanvasRenderingContext2D, sim: GameSimulation): void {
    if (sim.decals.length === 0) return;

    ctx.save();
    for (const d of sim.decals) {
      const fade = Math.min(1, d.life / Math.min(3.5, d.maxLife));
      const pos = gridToIso(d.gx, d.gy, 0);
      const rx = d.radius * ISO_TILE_W * 0.45;
      const ry = d.radius * ISO_TILE_H * 0.45;

      if (d.kind === 'scorch' && this.decalScorch) {
        ctx.globalAlpha = fade;
        ctx.drawImage(this.decalScorch, pos.x - rx, pos.y - ry, rx * 2, ry * 2);
      } else if (d.kind === 'frost' && this.decalFrost) {
        ctx.globalAlpha = fade;
        ctx.drawImage(this.decalFrost, pos.x - rx, pos.y - ry, rx * 2, ry * 2);
      } else if (d.kind === 'crack') {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = `rgba(12, 13, 18, ${0.58 * fade})`;
        ctx.lineWidth = 1.6;
        for (let k = 0; k < 5; k++) {
          const ang = (k / 5) * Math.PI * 2 + d.seed;
          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y);
          ctx.lineTo(pos.x + Math.cos(ang) * rx, pos.y + Math.sin(ang) * ry);
          ctx.stroke();
        }
      } else {
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgba(34, 56, 26, ${0.42 * fade})`;
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawFloorTrap(
    ctx: CanvasRenderingContext2D,
    trap: PlacedTrap,
    time: number
  ): void {
    const center = gridToIso(trap.gx + 0.5, trap.gy + 0.5, 0);
    const insetD = this.insetDiamond(getTileDiamond(trap.gx, trap.gy, 0), 0.13);

    if (trap.kind === 'tar') {
      ctx.save();
      this.fillPoly(ctx, insetD, '#151921');
      ctx.strokeStyle = '#475366';
      ctx.lineWidth = 1.6;
      this.strokePoly(ctx, insetD);

      const b1 = 0.5 + 0.5 * Math.sin(time * 2.2 + trap.id);
      const b2 = 0.5 + 0.5 * Math.sin(time * 1.7 + trap.id * 2.3);
      ctx.fillStyle = 'rgba(148, 174, 204, 0.34)';
      ctx.beginPath();
      ctx.ellipse(center.x - 10, center.y - 2, 7 + b1 * 3, 3.2 + b1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(center.x + 11, center.y + 3, 5 + b2 * 2.5, 2.5 + b2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    if (trap.kind === 'spikes') {
      ctx.save();
      this.fillPoly(ctx, insetD, '#2a2e36');
      ctx.strokeStyle = trap.cooldownTimer > 0 ? '#555b68' : '#e07a52';
      ctx.lineWidth = 1.8;
      this.strokePoly(ctx, insetD);

      const ext = trap.activeAnim > 0 ? 17 * Math.sin(trap.activeAnim * Math.PI) : 4;
      const readyGlow = trap.cooldownTimer <= 0;

      for (let sx = -1; sx <= 1; sx++) {
        for (let sy = -1; sy <= 1; sy++) {
          const p = gridToIso(trap.gx + 0.5 + sx * 0.22, trap.gy + 0.5 + sy * 0.22, 0);
          ctx.fillStyle = '#111318';
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, 3.4, 1.9, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = trap.activeAnim > 0.15 ? '#ffd0a6' : readyGlow ? '#dce5ef' : '#656d7a';
          ctx.beginPath();
          ctx.moveTo(p.x - 2.8, p.y);
          ctx.lineTo(p.x, p.y - ext);
          ctx.lineTo(p.x + 2.8, p.y);
          ctx.closePath();
          ctx.fill();
        }
      }
      this.drawTrapCooldownBar(ctx, center.x, center.y + 13, trap);
      ctx.restore();
      return;
    }

    if (trap.kind === 'flip') {
      ctx.save();
      const lift = trap.activeAnim > 0 ? 12 * Math.sin(trap.activeAnim * Math.PI) : 0;
      const plate = this.insetDiamond(getTileDiamond(trap.gx, trap.gy, lift), 0.13);

      this.fillPoly(ctx, insetD, '#152022');
      this.fillPoly(ctx, plate, trap.cooldownTimer > 0 ? '#2b403f' : '#2f726a');
      ctx.strokeStyle = trap.cooldownTimer > 0 ? '#5c7572' : '#7bf0d5';
      ctx.lineWidth = 2;
      this.strokePoly(ctx, plate);

      const vec = CARDINAL_VECTORS[trap.facing];
      const pCenter = gridToIso(trap.gx + 0.5, trap.gy + 0.5, lift);
      const pTip = gridToIso(trap.gx + 0.5 + vec.dx * 0.32, trap.gy + 0.5 + vec.dy * 0.32, lift);
      const pLeft = gridToIso(
        trap.gx + 0.5 - vec.dx * 0.14 - vec.dy * 0.22,
        trap.gy + 0.5 - vec.dy * 0.14 + vec.dx * 0.22,
        lift
      );
      const pRight = gridToIso(
        trap.gx + 0.5 - vec.dx * 0.14 + vec.dy * 0.22,
        trap.gy + 0.5 - vec.dy * 0.14 - vec.dx * 0.22,
        lift
      );

      ctx.fillStyle = trap.cooldownTimer > 0 ? '#8ba8a2' : '#e4fff8';
      ctx.beginPath();
      ctx.moveTo(pTip.x, pTip.y);
      ctx.lineTo(pLeft.x, pLeft.y);
      ctx.lineTo(pCenter.x, pCenter.y);
      ctx.lineTo(pRight.x, pRight.y);
      ctx.closePath();
      ctx.fill();

      this.drawTrapCooldownBar(ctx, center.x, center.y + 13, trap);
      ctx.restore();
    }
  }

  private drawTrapCooldownBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    trap: PlacedTrap
  ): void {
    const maxCd = TRAP_SPECS[trap.kind].cooldown;
    if (maxCd <= 0 || trap.cooldownTimer <= 0) return;
    const ratio = 1 - trap.cooldownTimer / maxCd;
    const w = 28;
    ctx.fillStyle = 'rgba(10, 12, 16, 0.78)';
    ctx.fillRect(x - w * 0.5, y, w, 4);
    ctx.fillStyle = '#f2c15a';
    ctx.fillRect(x - w * 0.5, y, w * ratio, 4);
  }

  private drawPathPreviews(ctx: CanvasRenderingContext2D, sim: GameSimulation): void {
    const isPreviewingReroute = sim.hoverPreviewPaths !== null;
    const showPaths =
      sim.phase === 'prep' ||
      sim.phase === 'title' ||
      isPreviewingReroute ||
      sim.selectedTrapKind === 'barricade';
    if (!showPaths) return;

    const paths = sim.hoverPreviewPaths ?? sim.previewPaths;
    const strokeColor = isPreviewingReroute
      ? 'rgba(84, 245, 206, 0.85)'
      : 'rgba(248, 186, 78, 0.62)';
    const dotColor = isPreviewingReroute ? '#8affdf' : '#ffe082';

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const path of paths) {
      if (path.length < 2) continue;
      const pts: Vec2[] = path.map((p: GridPos) => gridToIso(p.gx + 0.5, p.gy + 0.5, 2));

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = isPreviewingReroute ? 4.2 : 3.2;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -sim.time * 42;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();

      ctx.setLineDash([]);
      const segCount = pts.length - 1;
      for (let m = 0; m < 4; m++) {
        const t = ((sim.time * 0.24 + m * 0.25) % 1) * segCount;
        const idx = Math.min(segCount - 1, Math.floor(t));
        const frac = t - idx;
        const px = pts[idx].x + (pts[idx + 1].x - pts[idx].x) * frac;
        const py = pts[idx].y + (pts[idx + 1].y - pts[idx].y) * frac;
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(px, py, 3.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private drawPlacementOverlay(ctx: CanvasRenderingContext2D, sim: GameSimulation): void {
    const kind = sim.selectedTrapKind;
    if (!kind) return;

    const spec = TRAP_SPECS[kind];
    const pulse = 0.5 + 0.5 * Math.sin(sim.time * 5.2);
    const { grid, rows, cols } = sim.map;

    ctx.save();

    if (spec.surface === 'wall') {
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          if (grid[gy][gx].type !== 'wall') continue;
          const faces: WallFace[] = ['se', 'sw'];
          for (const face of faces) {
            if (!isValidWallTrapFace(grid, rows, cols, sim.traps, gx, gy, face)) continue;
            const quad = getWallFaceQuad(gx, gy, face);
            this.fillPoly(ctx, quad, `rgba(242, 186, 72, ${0.16 + 0.1 * pulse})`);
            ctx.strokeStyle = `rgba(255, 212, 108, ${0.56 + 0.24 * pulse})`;
            ctx.lineWidth = 1.8;
            this.strokePoly(ctx, quad);
          }
        }
      }
    } else if (spec.surface === 'ceiling') {
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const cell = grid[gy][gx];
          if (!cell.hasArch || cell.type !== 'floor') continue;
          const occupied = sim.traps.some(
            (t) => t.gx === gx && t.gy === gy && TRAP_SPECS[t.kind].surface === 'ceiling'
          );
          if (occupied) continue;
          const d = getTileDiamond(gx, gy, 2);
          this.fillPoly(ctx, d, `rgba(235, 104, 78, ${0.18 + 0.12 * pulse})`);
          ctx.strokeStyle = `rgba(255, 146, 114, ${0.68 + 0.22 * pulse})`;
          ctx.lineWidth = 2.2;
          this.strokePoly(ctx, d);
        }
      }
    } else {
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          if (grid[gy][gx].type !== 'floor') continue;
          const occupied = sim.traps.some(
            (t) =>
              t.gx === gx &&
              t.gy === gy &&
              (TRAP_SPECS[t.kind].surface === 'floor' ||
                TRAP_SPECS[t.kind].surface === 'blocker')
          );
          if (occupied) continue;
          const d = getTileDiamond(gx, gy, 1);
          this.fillPoly(ctx, d, `rgba(92, 230, 180, ${0.08 + 0.05 * pulse})`);
          ctx.strokeStyle = `rgba(116, 240, 196, ${0.28 + 0.14 * pulse})`;
          ctx.lineWidth = 1.1;
          this.strokePoly(ctx, d);
        }
      }
    }

    if (sim.placementHover) {
      const h = sim.placementHover;
      const fill = h.valid ? 'rgba(72, 236, 178, 0.36)' : 'rgba(240, 74, 68, 0.38)';
      const stroke = h.valid ? '#74ffd0' : '#ff6b63';

      if (spec.surface === 'wall' && h.wallFace) {
        const quad = getWallFaceQuad(h.gx, h.gy, h.wallFace);
        this.fillPoly(ctx, quad, fill);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2.8;
        this.strokePoly(ctx, quad);

        if (h.valid) {
          const dir = CARDINAL_VECTORS[h.wallFace];
          const p0 = gridToIso(h.gx + 0.5 + dir.dx * 0.55, h.gy + 0.5 + dir.dy * 0.55, 20);
          const p1 = gridToIso(h.gx + 0.5 + dir.dx * 4.5, h.gy + 0.5 + dir.dy * 4.5, 20);
          ctx.strokeStyle = 'rgba(255, 210, 96, 0.8)';
          ctx.lineWidth = 2.6;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else if (h.gx >= 0 && h.gy >= 0 && h.gx < cols && h.gy < rows) {
        const d = getTileDiamond(h.gx, h.gy, 2);
        this.fillPoly(ctx, d, fill);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2.8;
        this.strokePoly(ctx, d);

        if (kind === 'flip' && h.valid && h.facing) {
          const vec = CARDINAL_VECTORS[h.facing];
          const p0 = gridToIso(h.gx + 0.5, h.gy + 0.5, 6);
          const p1 = gridToIso(h.gx + 0.5 + vec.dx * 1.4, h.gy + 0.5 + vec.dy * 1.4, 6);
          ctx.strokeStyle = '#85ffe2';
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
          ctx.fillStyle = '#85ffe2';
          ctx.beginPath();
          ctx.arc(p1.x, p1.y, 4.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.restore();
  }

  private drawDepthSortedObjects(
    ctx: CanvasRenderingContext2D,
    sim: GameSimulation
  ): void {
    const drawables: DepthDrawable[] = [];
    const { grid, rows, cols } = sim.map;

    const wallTrapMap = new Map<string, PlacedTrap[]>();
    for (const t of sim.traps) {
      if (t.kind === 'arrow_wall') {
        const key = `${t.gx},${t.gy}`;
        const list = wallTrapMap.get(key) ?? [];
        list.push(t);
        wallTrapMap.set(key, list);
      }
    }

    // 1. Walls (single drawImage from cached wall sprites!) & mounted Arrow Walls & Torches
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const cell = grid[gy][gx];
        if (cell.type !== 'wall') continue;
        const mounted = wallTrapMap.get(`${gx},${gy}`);
        const isCutaway = this.isCutawayWall(grid, rows, cols, gx, gy, cell, mounted);
        drawables.push({
          depth: gx + gy + 0.5,
          layer: 0,
          draw: (c) => this.drawWallBlockFast(c, cell, mounted, sim.time, isCutaway),
        });
      }
    }

    // 2. Arcane Rift Crystal Props
    for (const rift of sim.map.rifts) {
      drawables.push({
        depth: rift.gx + rift.gy + 0.55,
        layer: 1,
        draw: (c) => this.drawRiftProp(c, rift.gx, rift.gy, sim.time),
      });
    }

    // 3. Barricades
    for (const t of sim.traps) {
      if (t.kind !== 'barricade') continue;
      drawables.push({
        depth: t.gx + t.gy + 0.58,
        layer: 1,
        draw: (c) => this.drawBarricade(c, t),
      });
    }

    // 4. Warmage Hero
    drawables.push({
      depth: sim.hero.gx + sim.hero.gy - 0.15,
      layer: 2,
      draw: (c) => this.drawHero(c, sim),
    });

    // 5. Enemies
    for (const enemy of sim.enemies) {
      if (enemy.dead) continue;
      drawables.push({
        depth: enemy.gx + enemy.gy - 0.15,
        layer: 2,
        draw: (c) => this.drawEnemy(c, enemy, sim),
      });
    }

    // 6. Projectiles
    for (const p of sim.projectiles) {
      drawables.push({
        depth: p.gx + p.gy,
        layer: 3,
        draw: (c) => this.drawProjectile(c, p),
      });
    }

    drawables.sort((a, b) => a.depth - b.depth || a.layer - b.layer);
    for (const item of drawables) {
      item.draw(ctx);
    }
  }

  private isCutawayWall(
    grid: Cell[][],
    rows: number,
    cols: number,
    gx: number,
    gy: number,
    cell: Cell,
    wallTraps: PlacedTrap[] | undefined
  ): boolean {
    if (cell.torch || (wallTraps && wallTraps.length > 0)) return false;

    const isInterior = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
      const t = grid[y][x].type;
      return t === 'floor' || t === 'lava' || t === 'spawn' || t === 'rift';
    };

    if (isInterior(gx + 1, gy) || isInterior(gx, gy + 1)) {
      return false;
    }

    if (gx >= cols - 2 || gy >= rows - 2) {
      return true;
    }
    if (isInterior(gx - 1, gy) || isInterior(gx, gy - 1)) {
      return true;
    }
    return false;
  }

  private drawWallBlockFast(
    ctx: CanvasRenderingContext2D,
    cell: Cell,
    wallTraps: PlacedTrap[] | undefined,
    time: number,
    isCutaway: boolean
  ): void {
    const cache = isCutaway ? this.wallCutawayCache : this.wallFullCache;
    const sprite = cache[cell.variant % cache.length];
    if (sprite) {
      const center = gridToIso(cell.gx + 0.5, cell.gy + 0.5, 0);
      ctx.drawImage(sprite.canvas, center.x - sprite.anchorX, center.y - sprite.anchorY);
    }

    if (wallTraps) {
      for (const trap of wallTraps) {
        if (!trap.wallFace) continue;
        this.drawArrowWallMount(ctx, trap, trap.wallFace);
      }
    }

    if (cell.torch) {
      this.drawWallTorch(ctx, cell.gx, cell.gy, cell.torch, time);
    }
  }

  private drawArrowWallMount(
    ctx: CanvasRenderingContext2D,
    trap: PlacedTrap,
    face: WallFace
  ): void {
    const quad = getWallFaceQuad(trap.gx, trap.gy, face, ISO_WALL_H);
    const panel = this.insetQuad(quad, 0.16);
    ctx.save();
    this.fillPoly(ctx, panel, '#352b22');
    ctx.strokeStyle = trap.cooldownTimer > 0 ? '#786c5c' : '#f0b84b';
    ctx.lineWidth = 2.2;
    this.strokePoly(ctx, panel);

    for (let i = 0; i < 5; i++) {
      const u = 0.2 + (i / 4) * 0.6;
      const v = i % 2 === 0 ? 0.36 : 0.64;
      const px =
        (1 - u) * (1 - v) * panel[0].x +
        u * (1 - v) * panel[1].x +
        u * v * panel[2].x +
        (1 - u) * v * panel[3].x;
      const py =
        (1 - u) * (1 - v) * panel[0].y +
        u * (1 - v) * panel[1].y +
        u * v * panel[2].y +
        (1 - u) * v * panel[3].y;

      ctx.fillStyle = trap.activeAnim > 0.2 ? '#fff0a6' : '#120e0c';
      ctx.beginPath();
      ctx.arc(px, py, trap.activeAnim > 0.2 ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawWallTorch(
    ctx: CanvasRenderingContext2D,
    gx: number,
    gy: number,
    face: WallFace,
    time: number
  ): void {
    const quad = getWallFaceQuad(gx, gy, face, ISO_WALL_H);
    const mx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) * 0.25;
    const my = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) * 0.25 - 4;
    const flicker = 0.86 + 0.14 * Math.sin(time * 13 + gx * 3 + gy * 7);

    ctx.save();
    ctx.strokeStyle = '#1f222a';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(mx, my + 8);
    ctx.lineTo(mx, my - 2);
    ctx.stroke();

    ctx.fillStyle = '#ff8b2b';
    ctx.beginPath();
    ctx.ellipse(mx, my - 6, 4.2 * flicker, 6.8 * flicker, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff3b8';
    ctx.beginPath();
    ctx.ellipse(mx, my - 5, 2.0 * flicker, 3.6 * flicker, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawBarricade(ctx: CanvasRenderingContext2D, trap: PlacedTrap): void {
    const ground = gridToIso(trap.gx + 0.5, trap.gy + 0.5, 0);

    ctx.save();
    if (this.atlas.barricade) {
      const img = this.atlas.barricade;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
      ctx.beginPath();
      ctx.ellipse(ground.x, ground.y + 3, 34, 17, 0, 0, Math.PI * 2);
      ctx.fill();

      const drawW = 76;
      const drawH = drawW * (img.height / img.width);
      ctx.drawImage(img, ground.x - drawW * 0.5, ground.y - drawH + 22, drawW, drawH);
    } else {
      const h = 30;
      const topD = this.insetDiamond(getTileDiamond(trap.gx, trap.gy, h), 0.1);
      const seQuad = this.insetQuad(getWallFaceQuad(trap.gx, trap.gy, 'se', h), 0.08);
      const swQuad = this.insetQuad(getWallFaceQuad(trap.gx, trap.gy, 'sw', h), 0.08);
      this.fillPoly(ctx, swQuad, '#6b4222');
      this.fillPoly(ctx, seQuad, '#87552d');
      this.fillPoly(ctx, topD, '#a36b3b');
      ctx.strokeStyle = '#333740';
      ctx.lineWidth = 2.4;
      this.strokePoly(ctx, swQuad);
      this.strokePoly(ctx, seQuad);
      this.strokePoly(ctx, topD);
    }

    if (trap.hp < trap.maxHp) {
      const ratio = Math.max(0, trap.hp / trap.maxHp);
      const bw = 42;
      const c = gridToIso(trap.gx + 0.5, trap.gy + 0.5, 42);
      ctx.fillStyle = 'rgba(10, 12, 16, 0.85)';
      ctx.fillRect(c.x - bw * 0.5, c.y - 12, bw, 5);
      ctx.fillStyle = ratio > 0.45 ? '#e6a84c' : '#ff5547';
      ctx.fillRect(c.x - bw * 0.5 + 1, c.y - 11, (bw - 2) * ratio, 3);
    }
    ctx.restore();
  }

  private drawPaintedSprite(
    ctx: CanvasRenderingContext2D,
    entry: SpriteEntry,
    x: number,
    y: number,
    targetH: number,
    flipX: boolean,
    scaleX: number,
    scaleY: number,
    rotation: number,
    hitFlash: number
  ): void {
    const img = entry.img;
    const aspect = (img.naturalWidth || img.width) / Math.max(1, img.naturalHeight || img.height);
    const drawH = targetH;
    const drawW = drawH * aspect;

    ctx.save();
    ctx.translate(x, y);
    if (rotation !== 0) {
      ctx.translate(0, -drawH * 0.45);
      ctx.rotate(rotation);
      ctx.translate(0, drawH * 0.45);
    }
    ctx.scale((flipX ? -1 : 1) * scaleX, scaleY);
    ctx.drawImage(img, -drawW * 0.5, -drawH + 6, drawW, drawH);

    if (hitFlash > 0.12) {
      ctx.globalAlpha = Math.min(0.55, hitFlash * 0.65);
      ctx.drawImage(entry.flash, -drawW * 0.5, -drawH + 6, drawW, drawH);
    }
    ctx.restore();
  }

  private drawHero(ctx: CanvasRenderingContext2D, sim: GameSimulation): void {
    const h = sim.hero;
    const base = gridToIso(h.gx, h.gy, 0);
    const moving = Math.hypot(h.vx, h.vy) > 0.25;
    const bob = moving ? Math.abs(Math.sin(h.walkPhase)) * 4.5 : Math.sin(sim.time * 2.8) * 1.2;
    const sx = moving ? 1 + Math.sin(h.walkPhase * 2) * 0.04 : 1;
    const sy = moving ? 1 - Math.sin(h.walkPhase * 2) * 0.04 : 1;

    ctx.save();

    if (h.targetEnemyId !== null) {
      const target = sim.enemies.find((e) => e.id === h.targetEnemyId && !e.dead);
      if (target) {
        const tp = gridToIso(target.gx, target.gy, target.z);
        ctx.strokeStyle = 'rgba(108, 240, 255, 0.82)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(tp.x, tp.y, 19, 10, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.ellipse(base.x, base.y + 2, 18, 9.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = h.dashTimer > 0 ? '#74ffe2' : 'rgba(98, 224, 255, 0.72)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(base.x, base.y + 1, 21, 11, 0, 0, Math.PI * 2);
    ctx.stroke();

    const screenDirX = h.facingX - h.facingY;
    const flipX = screenDirX < -0.05;

    if (this.atlas.hero) {
      this.drawPaintedSprite(
        ctx,
        this.atlas.hero,
        base.x,
        base.y - h.z - bob,
        74,
        flipX,
        sx,
        sy,
        h.dashTimer > 0 ? (flipX ? -0.18 : 0.18) : 0,
        h.castAnim > 0.6 ? 0.35 : 0
      );

      if (h.recoilAnim > 0.35) {
        const tipX = base.x + (flipX ? -24 : 24);
        const tipY = base.y - 26 - bob;
        ctx.fillStyle = 'rgba(130, 252, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(tipX, tipY, 5.5 * h.recoilAnim, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = '#2458a6';
      ctx.beginPath();
      ctx.arc(base.x, base.y - 22 - bob, 13, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawEnemy(
    ctx: CanvasRenderingContext2D,
    enemy: Enemy,
    sim: GameSimulation
  ): void {
    const spec = ENEMY_SPECS[enemy.kind];
    const ground = gridToIso(enemy.gx, enemy.gy, 0);
    const body = gridToIso(enemy.gx, enemy.gy, enemy.z);
    const moving = !enemy.airborne && enemy.freezeTimer <= 0 && enemy.staggerTimer <= 0;
    const bob = moving ? Math.abs(Math.sin(enemy.walkPhase)) * 3.8 : 0;
    const sx = moving ? 1 + Math.sin(enemy.walkPhase * 2) * 0.045 : 1;
    const sy = moving ? 1 - Math.sin(enemy.walkPhase * 2) * 0.045 : 1;
    const shadowScale = Math.max(0.42, 1 - enemy.z / 220);

    ctx.save();

    ctx.fillStyle = `rgba(0, 0, 0, ${0.48 * shadowScale})`;
    ctx.beginPath();
    ctx.ellipse(
      ground.x,
      ground.y + 2,
      spec.radius * 50 * shadowScale,
      spec.radius * 25 * shadowScale,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    if (enemy.tarTimer > 0 && !enemy.airborne) {
      ctx.fillStyle = 'rgba(18, 22, 28, 0.8)';
      ctx.beginPath();
      ctx.ellipse(ground.x, ground.y + 1, 15, 7.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const screenDirX = enemy.facingX - enemy.facingY;
    const flipX = screenDirX < -0.05;
    const spriteH = ENEMY_SPRITE_HEIGHT[enemy.kind];
    const spriteEntry = this.atlas.enemies[enemy.kind];

    if (spriteEntry) {
      const flashAmt =
        enemy.kind === 'sapper' &&
        enemy.fuseTimer > 0 &&
        Math.floor(sim.time * 18) % 2 === 0
          ? 0.75
          : enemy.hitFlash;

      this.drawPaintedSprite(
        ctx,
        spriteEntry,
        body.x,
        body.y - bob,
        spriteH,
        flipX,
        sx,
        sy,
        enemy.airborne ? sim.time * 9 + enemy.id : 0,
        flashAmt
      );
    } else {
      ctx.fillStyle = '#5e8c45';
      ctx.beginPath();
      ctx.arc(body.x, body.y - 20 - bob, 12, 0, Math.PI * 2);
      ctx.fill();
    }

    if (enemy.freezeTimer > 0) {
      const fh = spriteH * 0.85;
      const fw = spriteH * 0.28;
      ctx.fillStyle = 'rgba(116, 236, 255, 0.44)';
      ctx.strokeStyle = '#d8fbff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(body.x, body.y - fh - 4);
      ctx.lineTo(body.x + fw, body.y - fh * 0.5);
      ctx.lineTo(body.x + fw * 0.75, body.y + 2);
      ctx.lineTo(body.x - fw * 0.75, body.y + 2);
      ctx.lineTo(body.x - fw, body.y - fh * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();

    const barTop = body.y - spriteH - 6;
    if (enemy.hp < enemy.maxHp || enemy.kind === 'ogre') {
      const bw = enemy.kind === 'ogre' ? 52 : 32;
      const bh = enemy.kind === 'ogre' ? 6 : 4;
      const ratio = Math.max(0, enemy.hp / enemy.maxHp);
      const bx = body.x - bw * 0.5;
      ctx.fillStyle = 'rgba(10, 12, 16, 0.85)';
      ctx.fillRect(bx - 1, barTop - 1, bw + 2, bh + 2);
      ctx.fillStyle = enemy.kind === 'ogre' ? '#f04a3e' : '#73e05a';
      ctx.fillRect(bx, barTop, bw * ratio, bh);
    }

    if (enemy.kind === 'sapper') {
      ctx.fillStyle = '#ff6347';
      ctx.font = '800 13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#120c0c';
      ctx.lineWidth = 3;
      ctx.strokeText('!', body.x, barTop - 6);
      ctx.fillText('!', body.x, barTop - 6);
    }
  }

  private drawProjectile(ctx: CanvasRenderingContext2D, p: Projectile): void {
    const head = gridToIso(p.gx, p.gy, p.z);
    const tail = gridToIso(p.gx - p.vx * 0.04, p.gy - p.vy * 0.04, p.z);

    ctx.save();
    ctx.lineCap = 'round';
    if (p.kind === 'hero_bolt') {
      ctx.strokeStyle = 'rgba(90, 238, 255, 0.45)';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();

      ctx.strokeStyle = '#7ef4ff';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 2.8, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = '#f8c355';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();

      ctx.fillStyle = '#fff8d6';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawOverheadLayer(ctx: CanvasRenderingContext2D, sim: GameSimulation): void {
    const { grid, rows, cols } = sim.map;
    const pounderMap = new Map<string, PlacedTrap>();
    for (const t of sim.traps) {
      if (t.kind === 'pounder') {
        pounderMap.set(`${t.gx},${t.gy}`, t);
      }
    }

    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const cell = grid[gy][gx];
        if (!cell.hasArch) continue;

        const heroNear =
          Math.hypot(sim.hero.gx - (gx + 0.5), sim.hero.gy - (gy + 0.5)) < 1.15;
        const alpha = heroNear ? 0.36 : 0.92;

        const archH = ISO_WALL_H + 16;
        const leftP = gridToIso(gx, gy + 0.5, archH);
        const rightP = gridToIso(gx + 1, gy + 0.5, archH);
        const centerTop = gridToIso(gx + 0.5, gy + 0.5, archH);

        ctx.save();
        ctx.globalAlpha = alpha;

        ctx.strokeStyle = '#242730';
        ctx.lineWidth = 13;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(leftP.x, leftP.y);
        ctx.quadraticCurveTo(centerTop.x, centerTop.y - 12, rightP.x, rightP.y);
        ctx.stroke();

        ctx.strokeStyle = '#687082';
        ctx.lineWidth = 8.5;
        ctx.stroke();

        ctx.fillStyle = '#d9a94e';
        ctx.beginPath();
        ctx.arc(centerTop.x, centerTop.y - 6, 4.2, 0, Math.PI * 2);
        ctx.fill();

        const pounder = pounderMap.get(`${gx},${gy}`);
        if (pounder) {
          const slamFactor =
            pounder.activeAnim > 0
              ? Math.sin(Math.min(1, pounder.activeAnim * 1.4) * Math.PI)
              : 0;
          const blockZ = (archH - 18) * (1 - slamFactor) + 6 * slamFactor;
          const blockTop = this.insetDiamond(getTileDiamond(gx, gy, blockZ + 14), 0.22);
          const blockSe = this.insetQuad(getWallFaceQuad(gx, gy, 'se', 14), 0.22).map((pt) => ({
            x: pt.x,
            y: pt.y - blockZ,
          }));
          const blockSw = this.insetQuad(getWallFaceQuad(gx, gy, 'sw', 14), 0.22).map((pt) => ({
            x: pt.x,
            y: pt.y - blockZ,
          }));

          const chainTop = gridToIso(gx + 0.5, gy + 0.5, archH);
          const chainBot = gridToIso(gx + 0.5, gy + 0.5, blockZ + 14);
          ctx.strokeStyle = '#b0bac9';
          ctx.lineWidth = 2.8;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(chainTop.x, chainTop.y);
          ctx.lineTo(chainBot.x, chainBot.y);
          ctx.stroke();
          ctx.setLineDash([]);

          this.fillPoly(ctx, blockSw, '#4d2f2e');
          this.fillPoly(ctx, blockSe, '#73413c');
          this.fillPoly(ctx, blockTop, '#99574d');
          ctx.strokeStyle = pounder.cooldownTimer > 0 ? '#656570' : '#ff9370';
          ctx.lineWidth = 1.8;
          this.strokePoly(ctx, blockTop);

          this.drawTrapCooldownBar(ctx, chainTop.x, chainTop.y - 16, pounder);
        }

        ctx.restore();
      }
    }
  }

  private drawRings(ctx: CanvasRenderingContext2D, sim: GameSimulation): void {
    ctx.save();
    for (const r of sim.rings) {
      const alpha = Math.max(0, r.life / r.maxLife);
      const center = gridToIso(r.gx, r.gy, 6);
      const rx = r.radius * ISO_TILE_W * 0.52;
      const ry = r.radius * ISO_TILE_H * 0.52;

      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.kind === 'pounder' || r.kind === 'explosion' ? 5.5 : 3.8;

      if (r.kind === 'blast' && r.dirX !== undefined && r.dirY !== undefined) {
        const dirIso = gridToIso(r.gx + r.dirX, r.gy + r.dirY, 6);
        const angle = Math.atan2(dirIso.y - center.y, dirIso.x - center.x);
        ctx.beginPath();
        ctx.ellipse(center.x, center.y, rx, ry, 0, angle - 0.85, angle + 0.85);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.ellipse(center.x, center.y, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();

        if (r.kind === 'frost') {
          ctx.fillStyle = 'rgba(124, 240, 255, 0.2)';
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, sim: GameSimulation): void {
    ctx.save();
    for (const p of sim.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      const pos = gridToIso(p.gx, p.gy, p.z);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, p.size * (0.45 + 0.55 * alpha), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * High-FPS Localized Additive Lighting:
   * Stamps pre-baked radial glow sprites in world space with 'lighter' blending —
   * zero per-frame gradient allocations and zero expensive full-screen multiply readbacks!
   */
  private drawFastAdditiveLighting(
    ctx: CanvasRenderingContext2D,
    sim: GameSimulation
  ): void {
    const { grid, rows, cols } = sim.map;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const stamp = (
      img: HTMLCanvasElement | null,
      gx: number,
      gy: number,
      z: number,
      radiusX: number,
      radiusY: number,
      alpha: number
    ): void => {
      if (!img) return;
      const p = gridToIso(gx, gy, z);
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, p.x - radiusX, p.y - radiusY, radiusX * 2, radiusY * 2);
    };

    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const cell = grid[gy][gx];
        if (cell.type === 'lava') {
          const pulse = 0.88 + 0.12 * Math.sin(sim.time * 2.8 + gx + gy);
          stamp(this.glowLava, gx + 0.5, gy + 0.5, 4, 62 * pulse, 36 * pulse, 0.52);
        } else if (cell.type === 'rift') {
          const pulse = 0.9 + 0.1 * Math.sin(sim.time * 3.4);
          stamp(this.glowCyan, gx + 0.5, gy + 0.5, 24, 96 * pulse, 68 * pulse, 0.72);
        }
        if (cell.torch) {
          const flicker = 0.9 + 0.1 * Math.sin(sim.time * 13 + gx * 3 + gy * 7);
          stamp(
            this.glowAmber,
            gx + 0.5,
            gy + 0.5,
            ISO_WALL_H * 0.55,
            88 * flicker,
            68 * flicker,
            0.78
          );
        }
      }
    }

    // Subtle Warmage arcane aura
    stamp(this.glowCyan, sim.hero.gx, sim.hero.gy, 18, 48, 30, 0.24);

    // Active spell flashes
    for (const r of sim.rings) {
      const a = Math.max(0, r.life / r.maxLife);
      const glowImg = r.kind === 'frost' ? this.glowCyan : this.glowAmber;
      stamp(glowImg, r.gx, r.gy, 12, 115, 72, a * 0.7);
    }

    ctx.restore();
  }

  private drawFloatingTexts(ctx: CanvasRenderingContext2D, sim: GameSimulation): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const ft of sim.floatingTexts) {
      const alpha = Math.min(1, (ft.life / ft.maxLife) * 1.4);
      const pos = gridToIso(ft.gx, ft.gy, ft.z);
      const fontSize = Math.round(14 * ft.scale);
      ctx.globalAlpha = alpha;
      ctx.font = `800 ${fontSize}px Inter, sans-serif`;
      ctx.strokeStyle = 'rgba(10, 10, 14, 0.9)';
      ctx.lineWidth = 3.8;
      ctx.strokeText(ft.text, pos.x, pos.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, pos.x, pos.y);
    }
    ctx.restore();
  }

  private drawJoystick(
    ctx: CanvasRenderingContext2D,
    joystick: JoystickVisualState
  ): void {
    ctx.save();
    ctx.fillStyle = 'rgba(20, 22, 28, 0.45)';
    ctx.strokeStyle = 'rgba(232, 186, 98, 0.58)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(joystick.originX, joystick.originY, joystick.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(242, 198, 108, 0.85)';
    ctx.strokeStyle = '#1b1d24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(joystick.knobX, joystick.knobY, joystick.radius * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private tracePoly(ctx: CanvasRenderingContext2D, pts: Vec2[]): void {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.closePath();
  }

  private fillPoly(
    ctx: CanvasRenderingContext2D,
    pts: Vec2[],
    fill: string | CanvasGradient
  ): void {
    this.tracePoly(ctx, pts);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  private strokePoly(ctx: CanvasRenderingContext2D, pts: Vec2[]): void {
    this.tracePoly(ctx, pts);
    ctx.stroke();
  }

  private insetDiamond(pts: [Vec2, Vec2, Vec2, Vec2], amount: number): Vec2[] {
    const cx = (pts[0].x + pts[2].x) * 0.5;
    const cy = (pts[0].y + pts[2].y) * 0.5;
    return pts.map((p) => ({
      x: p.x + (cx - p.x) * amount,
      y: p.y + (cy - p.y) * amount,
    }));
  }

  private insetQuad(pts: [Vec2, Vec2, Vec2, Vec2], amount: number): Vec2[] {
    const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) * 0.25;
    const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) * 0.25;
    return pts.map((p) => ({
      x: p.x + (cx - p.x) * amount,
      y: p.y + (cy - p.y) * amount,
    }));
  }
}
