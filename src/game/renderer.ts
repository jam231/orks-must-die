import {
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

export class IsoRenderer {
  private floorCache: HTMLCanvasElement[] = [];

  constructor() {
    if (typeof document !== 'undefined') {
      this.buildFloorCache();
    }
  }

  private buildFloorCache(): void {
    const pad = 6;
    const w = ISO_TILE_W + pad * 2;
    const h = ISO_TILE_H + pad * 2;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const hw = ISO_TILE_W * 0.5;
    const hh = ISO_TILE_H * 0.5;

    const baseShades = ['#3d424c', '#393e48', '#414752', '#373c45'];

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

      const grad = g.createLinearGradient(cx - hw, cy - hh, cx + hw, cy + hh);
      grad.addColorStop(0, '#4c525f');
      grad.addColorStop(0.5, baseShades[v]);
      grad.addColorStop(1, '#2d313a');
      g.fillStyle = grad;
      g.fill();

      // Subtle bevel edge highlight (top-left warm light)
      g.strokeStyle = 'rgba(220, 228, 240, 0.14)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(cx - hw + 1.5, cy);
      g.lineTo(cx, cy - hh + 1.2);
      g.lineTo(cx + hw - 1.5, cy);
      g.stroke();

      // Dark stone mortar seam
      g.strokeStyle = 'rgba(14, 16, 22, 0.58)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(cx, cy - hh);
      g.lineTo(cx + hw, cy);
      g.lineTo(cx, cy + hh);
      g.lineTo(cx - hw, cy);
      g.closePath();
      g.stroke();

      // Inner flagstone groove / subtle crack variation
      g.strokeStyle = 'rgba(20, 22, 28, 0.32)';
      g.lineWidth = 1;
      if (v === 0) {
        g.beginPath();
        g.moveTo(cx - 14, cy - 3);
        g.lineTo(cx + 6, cy + 7);
        g.stroke();
      } else if (v === 1) {
        g.beginPath();
        g.moveTo(cx - 8, cy + 5);
        g.lineTo(cx + 12, cy - 5);
        g.stroke();
      } else if (v === 2) {
        g.fillStyle = 'rgba(255, 255, 255, 0.04)';
        g.beginPath();
        g.ellipse(cx - 8, cy - 2, 10, 4, 0.2, 0, Math.PI * 2);
        g.fill();
      }

      this.floorCache.push(c);
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    sim: GameSimulation,
    viewportW: number,
    viewportH: number,
    joystick: JoystickVisualState
  ): void {
    // 1. Rich obsidian dungeon backdrop
    const bgGrad = ctx.createRadialGradient(
      viewportW * 0.5,
      viewportH * 0.48,
      40,
      viewportW * 0.5,
      viewportH * 0.5,
      Math.max(viewportW, viewportH) * 0.78
    );
    bgGrad.addColorStop(0, '#1e1b1f');
    bgGrad.addColorStop(0.65, '#141317');
    bgGrad.addColorStop(1, '#0b0b0e');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, viewportW, viewportH);

    // Camera transform + screen shake
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

    // 2. Ground tiles (floor, lava, spawn, rift) & floor traps
    this.drawGroundLayer(ctx, sim);

    // 3. Live path preview chevrons
    this.drawPathPreviews(ctx, sim);

    // 4. Placement valid highlights & hover ghost
    this.drawPlacementOverlay(ctx, sim);

    // 5. Depth-sorted 2.5D entities (walls, arrow walls, barricades, hero, orks, projectiles)
    this.drawDepthSortedObjects(ctx, sim);

    // 6. Overhead archways & Ceiling Pounders
    this.drawOverheadLayer(ctx, sim);

    // 7. Spell rings, particles, floating combat text
    this.drawRings(ctx, sim);
    this.drawParticles(ctx, sim);
    this.drawFloatingTexts(ctx, sim);

    ctx.restore();

    // 8. Screen-space floating virtual joystick visual
    if (joystick.active) {
      this.drawJoystick(ctx, joystick);
    }

    // 9. Screen-space inspected trap indicator pulse
    if (sim.inspectedTrapId !== null) {
      const trap = sim.traps.find((t) => t.id === sim.inspectedTrapId);
      if (trap) {
        const pos = gridToIso(trap.gx + 0.5, trap.gy + 0.5, trap.wallFace ? 24 : 4);
        const screenPos = worldToScreen(pos.x, pos.y, sim.camera, viewportW, viewportH);
        ctx.save();
        ctx.strokeStyle = '#ffd566';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, 26 * sim.camera.zoom, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawGroundLayer(ctx: CanvasRenderingContext2D, sim: GameSimulation): void {
    const { grid, rows, cols } = sim.map;
    const floorTrapMap = new Map<string, PlacedTrap>();
    for (const t of sim.traps) {
      const surf = TRAP_SPECS[t.kind].surface;
      if (surf === 'floor') {
        floorTrapMap.set(`${t.gx},${t.gy}`, t);
      }
    }

    for (let sum = 0; sum <= rows + cols - 2; sum++) {
      for (let gy = 0; gy < rows; gy++) {
        const gx = sum - gy;
        if (gx < 0 || gx >= cols) continue;
        const cell = grid[gy][gx];
        if (cell.type === 'void' || cell.type === 'wall') continue;

        if (cell.type === 'lava') {
          this.drawLavaTile(ctx, gx, gy, sim.time);
        } else {
          this.drawFloorTile(ctx, cell);
          if (cell.type === 'spawn') {
            this.drawSpawnPortalGround(ctx, gx, gy, sim.time);
          } else if (cell.type === 'rift') {
            this.drawRiftGround(ctx, gx, gy, sim.time);
          }
        }

        const fTrap = floorTrapMap.get(`${gx},${gy}`);
        if (fTrap) {
          this.drawFloorTrap(ctx, fTrap, sim.time);
        }
      }
    }
  }

  private drawFloorTile(ctx: CanvasRenderingContext2D, cell: Cell): void {
    const center = gridToIso(cell.gx + 0.5, cell.gy + 0.5, 0);
    const cached = this.floorCache[cell.variant % this.floorCache.length];
    if (cached) {
      ctx.drawImage(cached, center.x - cached.width * 0.5, center.y - cached.height * 0.5);
    } else {
      const d = getTileDiamond(cell.gx, cell.gy, 0);
      this.fillPoly(ctx, d, '#3d424c');
    }

    // Subtle stone floor footing markers on Archway tiles
    if (cell.hasArch) {
      const d = getTileDiamond(cell.gx, cell.gy, 0);
      ctx.save();
      ctx.strokeStyle = 'rgba(226, 178, 92, 0.34)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      this.strokePoly(ctx, d);
      ctx.restore();
    }
  }

  private drawLavaTile(
    ctx: CanvasRenderingContext2D,
    gx: number,
    gy: number,
    time: number
  ): void {
    const topD = getTileDiamond(gx, gy, 0);
    const deepD = getTileDiamond(gx, gy, -10);

    // Outer recessed stone rim
    this.fillPoly(ctx, topD, '#1f1614');

    // Molten glowing basin
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.6 + gx * 0.9 + gy * 1.3);
    const center = gridToIso(gx + 0.5, gy + 0.5, -5);
    const grad = ctx.createRadialGradient(
      center.x,
      center.y,
      4,
      center.x,
      center.y,
      ISO_TILE_W * 0.52
    );
    grad.addColorStop(0, pulse > 0.5 ? '#ffe066' : '#ffbd45');
    grad.addColorStop(0.42, '#f25c19');
    grad.addColorStop(0.85, '#9e2108');
    grad.addColorStop(1, '#3d0c05');

    ctx.save();
    this.tracePoly(ctx, topD);
    ctx.clip();
    this.fillPoly(ctx, topD, grad);

    // Inner stone drop lip along top edges
    ctx.strokeStyle = '#2d2324';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(topD[3].x, topD[3].y);
    ctx.lineTo(topD[0].x, topD[0].y);
    ctx.lineTo(topD[1].x, topD[1].y);
    ctx.stroke();

    // Animated magma crust veins
    const drift = Math.sin(time * 1.4 + gx + gy) * 6;
    ctx.strokeStyle = 'rgba(255, 232, 128, 0.45)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(deepD[3].x + 16, center.y - 2 + drift * 0.3);
    ctx.quadraticCurveTo(center.x, center.y + 4 - drift * 0.3, deepD[1].x - 16, center.y);
    ctx.stroke();
    ctx.restore();
  }

  private drawSpawnPortalGround(
    ctx: CanvasRenderingContext2D,
    gx: number,
    gy: number,
    time: number
  ): void {
    const center = gridToIso(gx + 0.5, gy + 0.5, 0);
    const pulse = 0.65 + 0.35 * Math.sin(time * 4.2);

    ctx.save();
    const grad = ctx.createRadialGradient(center.x, center.y, 2, center.x, center.y, 34);
    grad.addColorStop(0, `rgba(255, 110, 48, ${0.75 * pulse})`);
    grad.addColorStop(0.6, `rgba(180, 35, 18, ${0.42 * pulse})`);
    grad.addColorStop(1, 'rgba(180, 35, 18, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, 34, 17, 0, 0, Math.PI * 2);
    ctx.fill();

    // War gate threshold bars
    ctx.strokeStyle = '#201818';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, 22, 11, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawRiftGround(
    ctx: CanvasRenderingContext2D,
    gx: number,
    gy: number,
    time: number
  ): void {
    const center = gridToIso(gx + 0.5, gy + 0.5, 0);
    const pulse = 0.7 + 0.3 * Math.sin(time * 3.4);

    ctx.save();
    // Arcane cyan halo
    const grad = ctx.createRadialGradient(center.x, center.y, 4, center.x, center.y, 46);
    grad.addColorStop(0, `rgba(140, 252, 255, ${0.85 * pulse})`);
    grad.addColorStop(0.45, `rgba(34, 198, 232, ${0.48 * pulse})`);
    grad.addColorStop(1, 'rgba(34, 198, 232, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, 46, 23, 0, 0, Math.PI * 2);
    ctx.fill();

    // Rotating arcane rune ring
    ctx.strokeStyle = '#7bf4ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, 28, 14, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Floating Rift crystal obelisk
    const bob = Math.sin(time * 3) * 5;
    const cy = center.y - 34 + bob;
    ctx.fillStyle = '#53e8ff';
    ctx.beginPath();
    ctx.moveTo(center.x, cy - 22);
    ctx.lineTo(center.x + 11, cy);
    ctx.lineTo(center.x, cy + 18);
    ctx.lineTo(center.x - 11, cy);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#c8fdff';
    ctx.beginPath();
    ctx.moveTo(center.x, cy - 22);
    ctx.lineTo(center.x + 5, cy - 2);
    ctx.lineTo(center.x, cy + 12);
    ctx.lineTo(center.x - 11, cy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawFloorTrap(
    ctx: CanvasRenderingContext2D,
    trap: PlacedTrap,
    time: number
  ): void {
    const center = gridToIso(trap.gx + 0.5, trap.gy + 0.5, 0);
    const insetD = this.insetDiamond(getTileDiamond(trap.gx, trap.gy, 0), 0.14);

    if (trap.kind === 'tar') {
      ctx.save();
      this.fillPoly(ctx, insetD, '#191c22');
      ctx.strokeStyle = '#38414e';
      ctx.lineWidth = 1.5;
      this.strokePoly(ctx, insetD);

      // Glossy animated tar sheen & slow bubbles
      const b1 = 0.5 + 0.5 * Math.sin(time * 2.2 + trap.id);
      const b2 = 0.5 + 0.5 * Math.sin(time * 1.7 + trap.id * 2.3);
      ctx.fillStyle = 'rgba(120, 140, 165, 0.28)';
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
      this.fillPoly(ctx, insetD, '#2f323a');
      ctx.strokeStyle = trap.cooldownTimer > 0 ? '#555a66' : '#c96f4a';
      ctx.lineWidth = 1.6;
      this.strokePoly(ctx, insetD);

      const ext = trap.activeAnim > 0 ? 15 * Math.sin(trap.activeAnim * Math.PI) : 3.5;
      const readyGlow = trap.cooldownTimer <= 0;

      for (let sx = -1; sx <= 1; sx++) {
        for (let sy = -1; sy <= 1; sy++) {
          const p = gridToIso(trap.gx + 0.5 + sx * 0.22, trap.gy + 0.5 + sy * 0.22, 0);
          // Socket hole
          ctx.fillStyle = '#15171c';
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, 3.2, 1.8, 0, 0, Math.PI * 2);
          ctx.fill();
          // Steel spike cone
          ctx.fillStyle = trap.activeAnim > 0.15 ? '#f5b089' : readyGlow ? '#c2ccd6' : '#656c78';
          ctx.beginPath();
          ctx.moveTo(p.x - 2.6, p.y);
          ctx.lineTo(p.x, p.y - ext);
          ctx.lineTo(p.x + 2.6, p.y);
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
      const lift = trap.activeAnim > 0 ? 10 * Math.sin(trap.activeAnim * Math.PI) : 0;
      const plate = this.insetDiamond(getTileDiamond(trap.gx, trap.gy, lift), 0.14);

      // Recessed spring pit beneath plate
      this.fillPoly(ctx, insetD, '#1b2628');
      // Brass/teal hinged launcher plate
      this.fillPoly(ctx, plate, trap.cooldownTimer > 0 ? '#2e4443' : '#2f6d65');
      ctx.strokeStyle = trap.cooldownTimer > 0 ? '#5a706e' : '#6be3c8';
      ctx.lineWidth = 1.8;
      this.strokePoly(ctx, plate);

      // Directional launch chevron (points cleanly in `trap.facing`)
      const vec = CARDINAL_VECTORS[trap.facing];
      const pCenter = gridToIso(trap.gx + 0.5, trap.gy + 0.5, lift);
      const pTip = gridToIso(trap.gx + 0.5 + vec.dx * 0.3, trap.gy + 0.5 + vec.dy * 0.3, lift);
      const pLeft = gridToIso(
        trap.gx + 0.5 - vec.dx * 0.14 - vec.dy * 0.2,
        trap.gy + 0.5 - vec.dy * 0.14 + vec.dx * 0.2,
        lift
      );
      const pRight = gridToIso(
        trap.gx + 0.5 - vec.dx * 0.14 + vec.dy * 0.2,
        trap.gy + 0.5 - vec.dy * 0.14 - vec.dx * 0.2,
        lift
      );

      ctx.fillStyle = trap.cooldownTimer > 0 ? '#8ba8a2' : '#d6fff4';
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
    ctx.fillStyle = 'rgba(10, 12, 16, 0.72)';
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
      ? 'rgba(84, 240, 200, 0.78)'
      : 'rgba(246, 178, 72, 0.52)';
    const dotColor = isPreviewingReroute ? '#80ffdf' : '#ffd573';

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const path of paths) {
      if (path.length < 2) continue;
      const pts: Vec2[] = path.map((p: GridPos) => gridToIso(p.gx + 0.5, p.gy + 0.5, 2));

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = isPreviewingReroute ? 4 : 3;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -sim.time * 42;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();

      // Animated marching orbs along path
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
        ctx.arc(px, py, 3.6, 0, Math.PI * 2);
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

    // Highlight eligible tiles/faces so touch placement is crystal clear
    if (spec.surface === 'wall') {
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          if (grid[gy][gx].type !== 'wall') continue;
          const faces: WallFace[] = ['se', 'sw'];
          for (const face of faces) {
            if (!isValidWallTrapFace(grid, rows, cols, sim.traps, gx, gy, face)) continue;
            const quad = getWallFaceQuad(gx, gy, face);
            this.fillPoly(ctx, quad, `rgba(235, 178, 66, ${0.14 + 0.1 * pulse})`);
            ctx.strokeStyle = `rgba(248, 200, 96, ${0.48 + 0.22 * pulse})`;
            ctx.lineWidth = 1.6;
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
          this.fillPoly(ctx, d, `rgba(232, 102, 76, ${0.16 + 0.12 * pulse})`);
          ctx.strokeStyle = `rgba(255, 138, 106, ${0.62 + 0.22 * pulse})`;
          ctx.lineWidth = 2;
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
          this.fillPoly(ctx, d, `rgba(92, 224, 176, ${0.07 + 0.05 * pulse})`);
          ctx.strokeStyle = `rgba(110, 236, 190, ${0.24 + 0.12 * pulse})`;
          ctx.lineWidth = 1;
          this.strokePoly(ctx, d);
        }
      }
    }

    // Active hover / drag ghost preview
    if (sim.placementHover) {
      const h = sim.placementHover;
      const fill = h.valid ? 'rgba(72, 232, 172, 0.34)' : 'rgba(240, 74, 68, 0.36)';
      const stroke = h.valid ? '#6effc8' : '#ff6b63';

      if (spec.surface === 'wall' && h.wallFace) {
        const quad = getWallFaceQuad(h.gx, h.gy, h.wallFace);
        this.fillPoly(ctx, quad, fill);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2.6;
        this.strokePoly(ctx, quad);

        // Draw firing lane ray preview!
        if (h.valid) {
          const dir = CARDINAL_VECTORS[h.wallFace];
          const p0 = gridToIso(h.gx + 0.5 + dir.dx * 0.55, h.gy + 0.5 + dir.dy * 0.55, 20);
          const p1 = gridToIso(h.gx + 0.5 + dir.dx * 4.5, h.gy + 0.5 + dir.dy * 4.5, 20);
          ctx.strokeStyle = 'rgba(255, 205, 92, 0.72)';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else if (
        h.gx >= 0 &&
        h.gy >= 0 &&
        h.gx < cols &&
        h.gy < rows
      ) {
        const d = getTileDiamond(h.gx, h.gy, 2);
        this.fillPoly(ctx, d, fill);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2.6;
        this.strokePoly(ctx, d);

        // Show Flip Trap launch direction arrow preview
        if (kind === 'flip' && h.valid && h.facing) {
          const vec = CARDINAL_VECTORS[h.facing];
          const p0 = gridToIso(h.gx + 0.5, h.gy + 0.5, 6);
          const p1 = gridToIso(h.gx + 0.5 + vec.dx * 1.4, h.gy + 0.5 + vec.dy * 1.4, 6);
          ctx.strokeStyle = '#7dffdf';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
          ctx.fillStyle = '#7dffdf';
          ctx.beginPath();
          ctx.arc(p1.x, p1.y, 4.5, 0, Math.PI * 2);
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

    // Wall traps indexed by wall tile
    const wallTrapMap = new Map<string, PlacedTrap[]>();
    for (const t of sim.traps) {
      if (t.kind === 'arrow_wall') {
        const key = `${t.gx},${t.gy}`;
        const list = wallTrapMap.get(key) ?? [];
        list.push(t);
        wallTrapMap.set(key, list);
      }
    }

    // 1. Walls & mounted Arrow Walls & Torches
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const cell = grid[gy][gx];
        if (cell.type !== 'wall') continue;
        const mounted = wallTrapMap.get(`${gx},${gy}`);
        const isCutaway = this.isCutawayWall(grid, rows, cols, gx, gy, cell, mounted);
        drawables.push({
          depth: gx + gy + 0.5,
          layer: 0,
          draw: (c) =>
            this.drawWallBlock(
              c,
              cell,
              mounted,
              sim.time,
              isCutaway ? 16 : ISO_WALL_H
            ),
        });
      }
    }

    // 2. Barricades
    for (const t of sim.traps) {
      if (t.kind !== 'barricade') continue;
      drawables.push({
        depth: t.gx + t.gy + 0.55,
        layer: 1,
        draw: (c) => this.drawBarricade(c, t),
      });
    }

    // 3. Warmage Hero
    drawables.push({
      depth: sim.hero.gx + sim.hero.gy - 0.15,
      layer: 2,
      draw: (c) => this.drawHero(c, sim),
    });

    // 4. Enemies
    for (const enemy of sim.enemies) {
      if (enemy.dead) continue;
      drawables.push({
        depth: enemy.gx + enemy.gy - 0.15,
        layer: 2,
        draw: (c) => this.drawEnemy(c, enemy, sim),
      });
    }

    // 5. Projectiles
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

    // Keep full height if either front face (SE or SW) opens into a playable lane
    if (isInterior(gx + 1, gy) || isInterior(gx, gy + 1)) {
      return false;
    }

    // Cut away outer south-east / south-west rim walls so interior Rift & lanes stay unobstructed
    if (gx >= cols - 2 || gy >= rows - 2) {
      return true;
    }
    if (isInterior(gx - 1, gy) || isInterior(gx, gy - 1)) {
      return true;
    }
    return false;
  }

  private drawWallBlock(
    ctx: CanvasRenderingContext2D,
    cell: Cell,
    wallTraps: PlacedTrap[] | undefined,
    time: number,
    wallH = ISO_WALL_H
  ): void {
    const { gx, gy } = cell;
    const topD = getTileDiamond(gx, gy, wallH);
    const seQuad = getWallFaceQuad(gx, gy, 'se', wallH);
    const swQuad = getWallFaceQuad(gx, gy, 'sw', wallH);

    // SW face (left side, deeper shadow)
    const swGrad = ctx.createLinearGradient(swQuad[0].x, swQuad[0].y, swQuad[2].x, swQuad[2].y);
    swGrad.addColorStop(0, '#363b45');
    swGrad.addColorStop(1, '#20242c');
    this.fillPoly(ctx, swQuad, swGrad);

    // SE face (right side, mid warm stone)
    const seGrad = ctx.createLinearGradient(seQuad[0].x, seQuad[0].y, seQuad[2].x, seQuad[2].y);
    seGrad.addColorStop(0, '#4a505e');
    seGrad.addColorStop(1, '#2c303a');
    this.fillPoly(ctx, seQuad, seGrad);

    // Masonry brick lines on tall vertical faces
    if (wallH > 24) {
      ctx.strokeStyle = 'rgba(15, 17, 22, 0.45)';
      ctx.lineWidth = 1;
      for (const frac of [0.34, 0.68]) {
        const yOff = wallH * frac;
        const d = getTileDiamond(gx, gy, yOff);
        ctx.beginPath();
        ctx.moveTo(d[3].x, d[3].y);
        ctx.lineTo(d[2].x, d[2].y);
        ctx.lineTo(d[1].x, d[1].y);
        ctx.stroke();
      }
    }

    // Top stone parapet cap
    const capGrad = ctx.createLinearGradient(topD[3].x, topD[0].y, topD[1].x, topD[2].y);
    capGrad.addColorStop(0, wallH < ISO_WALL_H ? '#4c525f' : '#626978');
    capGrad.addColorStop(1, wallH < ISO_WALL_H ? '#373c46' : '#474d5a');
    this.fillPoly(ctx, topD, capGrad);

    ctx.strokeStyle = 'rgba(230, 236, 248, 0.16)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(topD[3].x, topD[3].y);
    ctx.lineTo(topD[0].x, topD[0].y);
    ctx.lineTo(topD[1].x, topD[1].y);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(14, 16, 22, 0.65)';
    ctx.lineWidth = 1.2;
    this.strokePoly(ctx, swQuad);
    this.strokePoly(ctx, seQuad);

    // Mounted Arrow Walls
    if (wallTraps) {
      for (const trap of wallTraps) {
        if (!trap.wallFace) continue;
        this.drawArrowWallMount(ctx, trap, trap.wallFace);
      }
    }

    // Wall Torches
    if (cell.torch) {
      this.drawWallTorch(ctx, gx, gy, cell.torch, time);
    }
  }

  private drawArrowWallMount(
    ctx: CanvasRenderingContext2D,
    trap: PlacedTrap,
    face: WallFace
  ): void {
    const quad = getWallFaceQuad(trap.gx, trap.gy, face, ISO_WALL_H);
    const panel = this.insetQuad(quad, 0.18);
    ctx.save();
    this.fillPoly(ctx, panel, '#3b332b');
    ctx.strokeStyle = trap.cooldownTimer > 0 ? '#786c5c' : '#e6ad42';
    ctx.lineWidth = 2;
    this.strokePoly(ctx, panel);

    // 5 glowing arrow ports across the brass plate
    for (let i = 0; i < 5; i++) {
      const u = 0.2 + (i / 4) * 0.6;
      const v = i % 2 === 0 ? 0.38 : 0.64;
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

      ctx.fillStyle = trap.activeAnim > 0.2 ? '#fff0a6' : '#161210';
      ctx.beginPath();
      ctx.arc(px, py, trap.activeAnim > 0.2 ? 3.2 : 2.3, 0, Math.PI * 2);
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
    const flicker = 0.85 + 0.15 * Math.sin(time * 13 + gx * 3 + gy * 7);

    ctx.save();
    // Warm amber sconce glow
    const glow = ctx.createRadialGradient(mx, my - 5, 2, mx, my - 5, 42 * flicker);
    glow.addColorStop(0, 'rgba(255, 190, 82, 0.36)');
    glow.addColorStop(1, 'rgba(255, 130, 30, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(mx, my - 5, 42 * flicker, 0, Math.PI * 2);
    ctx.fill();

    // Iron bracket
    ctx.strokeStyle = '#252830';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(mx, my + 7);
    ctx.lineTo(mx, my - 2);
    ctx.stroke();

    // Flame teardrop
    ctx.fillStyle = '#ff8b2b';
    ctx.beginPath();
    ctx.ellipse(mx, my - 6, 3.8 * flicker, 6.2 * flicker, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff0a8';
    ctx.beginPath();
    ctx.ellipse(mx, my - 5, 1.8 * flicker, 3.2 * flicker, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawBarricade(ctx: CanvasRenderingContext2D, trap: PlacedTrap): void {
    const h = 30;
    const topD = this.insetDiamond(getTileDiamond(trap.gx, trap.gy, h), 0.1);
    const seQuad = this.insetQuad(getWallFaceQuad(trap.gx, trap.gy, 'se', h), 0.08);
    const swQuad = this.insetQuad(getWallFaceQuad(trap.gx, trap.gy, 'sw', h), 0.08);

    ctx.save();
    this.fillPoly(ctx, swQuad, '#6b4222');
    this.fillPoly(ctx, seQuad, '#87552d');
    this.fillPoly(ctx, topD, '#a36b3b');

    // Iron cross-strapping
    ctx.strokeStyle = '#333740';
    ctx.lineWidth = 2.4;
    this.strokePoly(ctx, swQuad);
    this.strokePoly(ctx, seQuad);
    this.strokePoly(ctx, topD);

    // Diagonal brace on both visible faces
    ctx.beginPath();
    ctx.moveTo(swQuad[0].x, swQuad[0].y);
    ctx.lineTo(swQuad[2].x, swQuad[2].y);
    ctx.moveTo(seQuad[0].x, seQuad[0].y);
    ctx.lineTo(seQuad[2].x, seQuad[2].y);
    ctx.stroke();

    // Iron shield emblem on top
    const c = gridToIso(trap.gx + 0.5, trap.gy + 0.5, h);
    ctx.fillStyle = '#c8d2de';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // HP bar when damaged
    if (trap.hp < trap.maxHp) {
      const ratio = Math.max(0, trap.hp / trap.maxHp);
      const bw = 38;
      ctx.fillStyle = 'rgba(12, 12, 16, 0.8)';
      ctx.fillRect(c.x - bw * 0.5, c.y - 18, bw, 5);
      ctx.fillStyle = ratio > 0.45 ? '#e6a84c' : '#ff5547';
      ctx.fillRect(c.x - bw * 0.5 + 1, c.y - 17, (bw - 2) * ratio, 3);
    }
    ctx.restore();
  }

  private drawHero(ctx: CanvasRenderingContext2D, sim: GameSimulation): void {
    const h = sim.hero;
    const base = gridToIso(h.gx, h.gy, 0);
    const bob = Math.abs(Math.sin(h.walkPhase)) * 3.5;
    const footY = base.y - h.z;

    ctx.save();

    // Target lock reticle on currently auto-aimed Ork
    if (h.targetEnemyId !== null) {
      const target = sim.enemies.find((e) => e.id === h.targetEnemyId && !e.dead);
      if (target) {
        const tp = gridToIso(target.gx, target.gy, target.z);
        ctx.strokeStyle = 'rgba(104, 232, 255, 0.72)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.ellipse(tp.x, tp.y, 17, 9, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Soft ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.beginPath();
    ctx.ellipse(base.x, base.y + 2, 15, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Warmage subtle cyan command ring
    ctx.strokeStyle = h.dashTimer > 0 ? '#6effdf' : 'rgba(92, 214, 245, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(base.x, base.y + 1, 18, 9.5, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Flowing royal cobalt cloak
    ctx.fillStyle = h.dashTimer > 0 ? '#5df2d6' : '#2458a6';
    ctx.beginPath();
    ctx.moveTo(base.x - 11, footY - 4);
    ctx.lineTo(base.x - 7, footY - 26 - bob);
    ctx.lineTo(base.x + 7, footY - 26 - bob);
    ctx.lineTo(base.x + 11, footY - 4);
    ctx.closePath();
    ctx.fill();

    // Gold chest trim & shoulder pads
    ctx.fillStyle = '#e6b44c';
    ctx.fillRect(base.x - 9, footY - 25 - bob, 18, 5);
    ctx.fillStyle = '#f5d27a';
    ctx.fillRect(base.x - 2, footY - 23 - bob, 4, 15);

    // Head & Warmage hood
    ctx.fillStyle = '#f3ceb0';
    ctx.beginPath();
    ctx.arc(base.x, footY - 31 - bob, 7.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1b417d';
    ctx.beginPath();
    ctx.arc(base.x, footY - 33 - bob, 8.2, Math.PI, Math.PI * 2);
    ctx.lineTo(base.x + 9, footY - 28 - bob);
    ctx.lineTo(base.x - 9, footY - 28 - bob);
    ctx.closePath();
    ctx.fill();

    // Arcane Crossbow pointed in iso-projected facing direction
    const aimWorld = gridToIso(h.gx + h.facingX * 0.55, h.gy + h.facingY * 0.55, 22 + bob);
    const handX = base.x;
    const handY = footY - 21 - bob;
    const adx = aimWorld.x - handX;
    const ady = aimWorld.y - handY;
    const alen = Math.hypot(adx, ady) || 1;
    const ux = adx / alen;
    const uy = ady / alen;
    const kick = h.recoilAnim * 4;

    ctx.strokeStyle = '#d9a443';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(handX - ux * kick, handY - uy * kick);
    ctx.lineTo(handX + ux * (17 - kick), handY + uy * (17 - kick));
    ctx.stroke();

    // Crossbow bow arms
    ctx.strokeStyle = '#6cf2ff';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(handX + ux * 11 - uy * 7, handY + uy * 11 + ux * 7);
    ctx.lineTo(handX + ux * 15, handY + uy * 15);
    ctx.lineTo(handX + ux * 11 + uy * 7, handY + uy * 11 - ux * 7);
    ctx.stroke();

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
    const bob = enemy.airborne || enemy.freezeTimer > 0 ? 0 : Math.abs(Math.sin(enemy.walkPhase)) * 3;
    const shadowScale = Math.max(0.45, 1 - enemy.z / 220);

    ctx.save();

    // Ground shadow
    ctx.fillStyle = `rgba(0, 0, 0, ${0.42 * shadowScale})`;
    ctx.beginPath();
    ctx.ellipse(
      ground.x,
      ground.y + 2,
      spec.radius * 44 * shadowScale,
      spec.radius * 22 * shadowScale,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Tarred feet visual
    if (enemy.tarTimer > 0 && !enemy.airborne) {
      ctx.fillStyle = 'rgba(20, 22, 28, 0.72)';
      ctx.beginPath();
      ctx.ellipse(ground.x, ground.y + 1, 13, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Apply slight spin when flung airborne by Flip Trap!
    ctx.translate(body.x, body.y - bob);
    if (enemy.airborne) {
      ctx.rotate(sim.time * 9 + enemy.id);
    }

    const flash = enemy.hitFlash > 0.15;
    const h = spec.height;

    if (enemy.kind === 'kobold') {
      // Compact fast Kobold Runner
      ctx.fillStyle = flash ? '#ffffff' : '#5aa670';
      ctx.beginPath();
      ctx.ellipse(0, -10, 8, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      // Pointy ears & glowing yellow eyes
      ctx.beginPath();
      ctx.moveTo(-7, -18);
      ctx.lineTo(-12, -24);
      ctx.lineTo(-3, -20);
      ctx.moveTo(7, -18);
      ctx.lineTo(12, -24);
      ctx.lineTo(3, -20);
      ctx.fill();
      ctx.fillStyle = '#ffe55c';
      ctx.fillRect(-4, -15, 2.5, 2.5);
      ctx.fillRect(1.5, -15, 2.5, 2.5);
    } else if (enemy.kind === 'sapper') {
      // Ork Sapper carrying a sizzling black powder keg overhead!
      ctx.fillStyle = flash ? '#ffffff' : '#658f48';
      ctx.beginPath();
      ctx.roundRect(-10, -21, 20, 19, 6);
      ctx.fill();
      // Powder keg overhead
      ctx.fillStyle = enemy.fuseTimer > 0 && Math.floor(sim.time * 16) % 2 === 0 ? '#ff5436' : '#2a2220';
      ctx.beginPath();
      ctx.ellipse(0, -30, 10, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c4863b';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Sizzling spark fuse
      ctx.fillStyle = '#ffe45e';
      ctx.beginPath();
      ctx.arc(0, -40, 3.2 + Math.sin(sim.time * 24) * 1.3, 0, Math.PI * 2);
      ctx.fill();
    } else if (enemy.kind === 'brute') {
      // Shielded Brute with iron tower shield
      ctx.fillStyle = flash ? '#ffffff' : '#4a6e39';
      ctx.beginPath();
      ctx.roundRect(-13, -32, 26, 29, 7);
      ctx.fill();
      // Spiked steel helmet
      ctx.fillStyle = '#4e5866';
      ctx.beginPath();
      ctx.arc(0, -34, 9, Math.PI, Math.PI * 2);
      ctx.fill();
      // Tower iron shield on front-right
      ctx.fillStyle = '#6f7c8e';
      ctx.strokeStyle = '#252a33';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(5, -28, 12, 23, 3);
      ctx.fill();
      ctx.stroke();
    } else if (enemy.kind === 'ogre') {
      // Massive Armored Ogre mini-boss
      ctx.fillStyle = flash ? '#ffffff' : '#577341';
      ctx.beginPath();
      ctx.roundRect(-20, -44, 40, 40, 12);
      ctx.fill();
      // Iron pauldrons & chestplate
      ctx.fillStyle = '#474c57';
      ctx.beginPath();
      ctx.ellipse(-16, -34, 8, 10, -0.3, 0, Math.PI * 2);
      ctx.ellipse(16, -34, 8, 10, 0.3, 0, Math.PI * 2);
      ctx.fill();
      // Head & tusks
      ctx.fillStyle = flash ? '#ffffff' : '#65854c';
      ctx.beginPath();
      ctx.arc(0, -48, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f2e8cf';
      ctx.beginPath();
      ctx.moveTo(-6, -43);
      ctx.lineTo(-9, -49);
      ctx.lineTo(-3, -44);
      ctx.moveTo(6, -43);
      ctx.lineTo(9, -49);
      ctx.lineTo(3, -44);
      ctx.fill();
      // Massive war club
      ctx.strokeStyle = '#5c4128';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(18, -18);
      ctx.lineTo(27, -42);
      ctx.stroke();
    } else {
      // Classic Ork Grunt
      ctx.fillStyle = flash ? '#ffffff' : '#5e8c45';
      ctx.beginPath();
      ctx.roundRect(-10, -25, 20, 22, 6);
      ctx.fill();
      // Iron harness
      ctx.strokeStyle = '#3d3026';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-9, -22);
      ctx.lineTo(9, -8);
      ctx.stroke();
      // Head & horned iron cap
      ctx.fillStyle = flash ? '#ffffff' : '#6fa152';
      ctx.beginPath();
      ctx.arc(0, -29, 7.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#484f5c';
      ctx.beginPath();
      ctx.arc(0, -31, 7.8, Math.PI, Math.PI * 2);
      ctx.fill();
    }

    // Frozen translucent ice crystal shell
    if (enemy.freezeTimer > 0) {
      ctx.fillStyle = 'rgba(116, 232, 255, 0.52)';
      ctx.strokeStyle = '#d4faff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, -h - 6);
      ctx.lineTo(14, -h * 0.55);
      ctx.lineTo(11, 0);
      ctx.lineTo(-11, 0);
      ctx.lineTo(-14, -h * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();

    // Overhead HP bar (always for Ogre, or whenever damaged)
    if (enemy.hp < enemy.maxHp || enemy.kind === 'ogre') {
      const bw = enemy.kind === 'ogre' ? 46 : 28;
      const bh = enemy.kind === 'ogre' ? 6 : 4;
      const ratio = Math.max(0, enemy.hp / enemy.maxHp);
      const bx = body.x - bw * 0.5;
      const by = body.y - h - 14;
      ctx.fillStyle = 'rgba(10, 12, 16, 0.8)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = enemy.kind === 'ogre' ? '#f04a3e' : '#73d65a';
      ctx.fillRect(bx, by, bw * ratio, bh);
    }

    // Sapper alert marker when targeting Barricades
    if (enemy.kind === 'sapper') {
      ctx.fillStyle = '#ff6347';
      ctx.font = '800 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', body.x, body.y - h - 20);
    }
  }

  private drawProjectile(ctx: CanvasRenderingContext2D, p: Projectile): void {
    const head = gridToIso(p.gx, p.gy, p.z);
    const tail = gridToIso(p.gx - p.vx * 0.035, p.gy - p.vy * 0.035, p.z);

    ctx.save();
    ctx.lineCap = 'round';
    if (p.kind === 'hero_bolt') {
      ctx.strokeStyle = '#5ae8ff';
      ctx.lineWidth = 3.6;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = '#f5be4f';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.lineTo(head.x, head.y);
      ctx.stroke();

      ctx.fillStyle = '#fff5cc';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 2, 0, Math.PI * 2);
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
        const alpha = heroNear ? 0.36 : 0.88;

        const archH = ISO_WALL_H + 14;
        const leftP = gridToIso(gx, gy + 0.5, archH);
        const rightP = gridToIso(gx + 1, gy + 0.5, archH);
        const centerTop = gridToIso(gx + 0.5, gy + 0.5, archH);

        ctx.save();
        ctx.globalAlpha = alpha;

        // Overhead stone arch beam spanning the tile
        ctx.strokeStyle = '#5a6070';
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(leftP.x, leftP.y);
        ctx.quadraticCurveTo(centerTop.x, centerTop.y - 10, rightP.x, rightP.y);
        ctx.stroke();

        ctx.strokeStyle = '#242730';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Mounted Ceiling Pounder slam block!
        const pounder = pounderMap.get(`${gx},${gy}`);
        if (pounder) {
          // Slam curve: drops sharply down to z=6 on activeAnim near 1, retracts up to archH-14
          const slamFactor =
            pounder.activeAnim > 0 ? Math.sin(Math.min(1, pounder.activeAnim * 1.4) * Math.PI) : 0;
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

          // Suspension chains
          const chainTop = gridToIso(gx + 0.5, gy + 0.5, archH);
          const chainBot = gridToIso(gx + 0.5, gy + 0.5, blockZ + 14);
          ctx.strokeStyle = '#9aa3b2';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(chainTop.x, chainTop.y);
          ctx.lineTo(chainBot.x, chainBot.y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Heavy iron-studded stone crush block
          this.fillPoly(ctx, blockSw, '#4a3130');
          this.fillPoly(ctx, blockSe, '#69403c');
          this.fillPoly(ctx, blockTop, '#8a5248');
          ctx.strokeStyle = pounder.cooldownTimer > 0 ? '#5e5e68' : '#ff8c69';
          ctx.lineWidth = 1.6;
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

      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.kind === 'pounder' || r.kind === 'explosion' ? 5 : 3.5;

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
          ctx.fillStyle = 'rgba(116, 232, 255, 0.16)';
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
      ctx.strokeStyle = 'rgba(10, 10, 14, 0.88)';
      ctx.lineWidth = 3.5;
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
    ctx.strokeStyle = 'rgba(232, 186, 98, 0.55)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(joystick.originX, joystick.originY, joystick.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(242, 198, 108, 0.82)';
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
