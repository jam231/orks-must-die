import { AudioEngine } from './audio';
import {
  computeComboBonusCoin,
  createEnemy,
  findNearestBarricade,
  getActiveComboCount,
  tagEnemyCombo,
} from './enemies';
import { createHero, moveHeroScreenSpace, pickSmartAutoAimTarget } from './hero';
import { computeMapWorldBounds, gridToIso } from './iso';
import { MAPS, ParsedMap, parseMap } from './maps';
import {
  FlowField,
  cellKey,
  computeFlowField,
  isWalkableForOrk,
  tracePreviewPaths,
} from './pathfinding';
import {
  buildBlockedSet,
  getTrapSellRefund,
  isValidWallTrapFace,
  rotateCardinalDir,
  validateTrapPlacement,
} from './traps';
import {
  CARDINAL_VECTORS,
  CameraState,
  ENEMY_SPECS,
  Enemy,
  EnemyKind,
  FloatingText,
  GamePhase,
  GridPos,
  Hero,
  MapDefinition,
  Particle,
  PlacedTrap,
  PlacementHover,
  Projectile,
  RingEffect,
  RunStats,
  TRAP_SPECS,
  TrapKind,
  WallFace,
} from './types';

interface ScheduledSpawn {
  spawnAt: number;
  kind: EnemyKind;
  spawnIndex: number;
}

export interface BannerNotice {
  text: string;
  subtext?: string;
  timer: number;
  maxTimer: number;
  tone: 'neutral' | 'warning' | 'gold' | 'victory';
}

export class GameSimulation {
  public map: ParsedMap;
  public phase: GamePhase = 'title';
  public paused = false;

  public time = 0;
  public waveElapsed = 0;
  public currentWaveIndex = 0; // 0-indexed
  public coin = 0;
  public riftPoints = 20;
  public maxRiftPoints = 20;

  public hero: Hero;
  public traps: PlacedTrap[] = [];
  public enemies: Enemy[] = [];
  public projectiles: Projectile[] = [];
  public particles: Particle[] = [];
  public rings: RingEffect[] = [];
  public floatingTexts: FloatingText[] = [];

  public flowField: FlowField;
  public previewPaths: GridPos[][] = [];
  public hoverPreviewPaths: GridPos[][] | null = null;
  public blockedSet: Set<string> = new Set();

  public selectedTrapKind: TrapKind | null = null;
  public inspectedTrapId: number | null = null;
  public placementHover: PlacementHover | null = null;

  public banner: BannerNotice | null = null;
  public stats: RunStats;
  public camera: CameraState;

  public audio: AudioEngine;

  // Input state fed by InputController
  public moveInputX = 0;
  public moveInputY = 0;

  private nextEntityId = 1;
  private pendingSpawns: ScheduledSpawn[] = [];
  private scheduledArrows: Array<{
    fireAt: number;
    gx: number;
    gy: number;
    vx: number;
    vy: number;
    damage: number;
    trapId: number;
  }> = [];

  public onHudDirty?: () => void;
  private hudDirtyAccum = 0;

  constructor(audio?: AudioEngine) {
    this.audio = audio ?? new AudioEngine();
    this.map = parseMap(MAPS[0]);
    this.hero = createHero(this.map.definition.heroStart.gx, this.map.definition.heroStart.gy);
    this.stats = this.createFreshStats();
    this.camera = {
      x: 0,
      y: 0,
      zoom: 1,
      minZoom: 0.48,
      maxZoom: 1.75,
      followHero: false,
      shakeTime: 0,
      shakeIntensity: 0,
    };
    this.flowField = computeFlowField(
      this.map.grid,
      this.map.rows,
      this.map.cols,
      this.map.rifts,
      this.blockedSet
    );
    this.loadMap(MAPS[0], 'title');
  }

  private createFreshStats(): RunStats {
    return {
      orksSlain: 0,
      lavaKills: 0,
      highestCombo: 0,
      totalComboBonus: 0,
      trapsPlaced: 0,
      barricadesLost: 0,
      elapsedSeconds: 0,
    };
  }

  public loadMap(def: MapDefinition, initialPhase: GamePhase = 'prep'): void {
    this.map = parseMap(def);
    this.phase = initialPhase;
    this.paused = false;
    this.time = 0;
    this.waveElapsed = 0;
    this.currentWaveIndex = 0;
    this.coin = def.startingCoin;
    this.riftPoints = def.maxRiftPoints;
    this.maxRiftPoints = def.maxRiftPoints;

    this.hero = createHero(def.heroStart.gx, def.heroStart.gy);
    this.traps = [];
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.rings = [];
    this.floatingTexts = [];
    this.pendingSpawns = [];
    this.scheduledArrows = [];

    this.selectedTrapKind = null;
    this.inspectedTrapId = null;
    this.placementHover = null;
    this.hoverPreviewPaths = null;
    this.stats = this.createFreshStats();

    this.rebuildPathing();

    const bounds = computeMapWorldBounds(this.map.rows, this.map.cols);
    this.camera.x = bounds.centerX;
    this.camera.y = bounds.centerY;
    this.camera.shakeTime = 0;

    if (initialPhase === 'prep') {
      this.showBanner(
        def.name,
        'Place traps & barricades, then tap Start Wave!',
        3.4,
        'gold'
      );
    } else {
      this.banner = null;
    }

    this.notifyHud();
  }

  public fitCameraToViewport(viewportW: number, viewportH: number): void {
    const bounds = computeMapWorldBounds(this.map.rows, this.map.cols);
    const mapW = Math.max(1, bounds.maxX - bounds.minX);
    const mapH = Math.max(1, bounds.maxY - bounds.minY);
    const padW = viewportW * 0.92;
    const padH = viewportH * 0.76; // Leave room for top HUD + bottom trap dock
    const fitZoom = Math.min(padW / mapW, padH / mapH);
    this.camera.minZoom = Math.max(0.36, Math.min(0.65, fitZoom * 0.78));
    this.camera.maxZoom = 1.85;
    this.camera.zoom = Math.max(this.camera.minZoom, Math.min(1.18, fitZoom * 1.04));
    this.camera.x = bounds.centerX;
    this.camera.y = bounds.centerY + 18;
  }

  public recenterCamera(viewportW: number, viewportH: number): void {
    if (this.phase === 'wave') {
      const iso = gridToIso(this.hero.gx, this.hero.gy, 0);
      this.camera.x = iso.x;
      this.camera.y = iso.y;
      this.camera.followHero = true;
    } else {
      this.camera.followHero = false;
      this.fitCameraToViewport(viewportW, viewportH);
    }
  }

  public showBanner(
    text: string,
    subtext: string | undefined,
    duration: number,
    tone: BannerNotice['tone'] = 'neutral'
  ): void {
    this.banner = {
      text,
      subtext,
      timer: duration,
      maxTimer: duration,
      tone,
    };
  }

  public rebuildPathing(): void {
    this.blockedSet = buildBlockedSet(this.traps);
    this.flowField = computeFlowField(
      this.map.grid,
      this.map.rows,
      this.map.cols,
      this.map.rifts,
      this.blockedSet
    );
    this.previewPaths = tracePreviewPaths(
      this.map.grid,
      this.map.rows,
      this.map.cols,
      this.map.spawns,
      this.flowField,
      this.blockedSet
    );
  }

  public selectTrapTool(kind: TrapKind | null): void {
    this.selectedTrapKind = this.selectedTrapKind === kind ? null : kind;
    this.inspectedTrapId = null;
    this.placementHover = null;
    this.hoverPreviewPaths = null;
    this.notifyHud();
  }

  public setPlacementHover(gx: number, gy: number, wallFace?: WallFace): void {
    if (!this.selectedTrapKind) {
      this.placementHover = null;
      this.hoverPreviewPaths = null;
      return;
    }
    const check = validateTrapPlacement(
      this.selectedTrapKind,
      gx,
      gy,
      wallFace,
      this.map.grid,
      this.map.rows,
      this.map.cols,
      this.map.spawns,
      this.map.rifts,
      this.traps,
      this.blockedSet,
      this.coin
    );
    this.placementHover = {
      gx,
      gy,
      wallFace,
      valid: check.valid,
      reason: check.reason,
      facing: check.facing,
    };

    // Live barricade rerouting preview!
    if (this.selectedTrapKind === 'barricade' && check.valid) {
      const nextBlocked = new Set(this.blockedSet);
      nextBlocked.add(cellKey(gx, gy));
      const previewField = computeFlowField(
        this.map.grid,
        this.map.rows,
        this.map.cols,
        this.map.rifts,
        nextBlocked
      );
      this.hoverPreviewPaths = tracePreviewPaths(
        this.map.grid,
        this.map.rows,
        this.map.cols,
        this.map.spawns,
        previewField,
        nextBlocked
      );
    } else {
      this.hoverPreviewPaths = null;
    }
  }

  public clearPlacementHover(): void {
    this.placementHover = null;
    this.hoverPreviewPaths = null;
  }

  public isWallFaceOpenForPlacement(gx: number, gy: number, face: WallFace): boolean {
    return isValidWallTrapFace(
      this.map.grid,
      this.map.rows,
      this.map.cols,
      this.traps,
      gx,
      gy,
      face
    );
  }

  public tryPlaceTrap(
    kind: TrapKind,
    gx: number,
    gy: number,
    wallFace?: WallFace
  ): PlacedTrap | null {
    if (this.phase !== 'prep' && this.phase !== 'wave') return null;
    const check = validateTrapPlacement(
      kind,
      gx,
      gy,
      wallFace,
      this.map.grid,
      this.map.rows,
      this.map.cols,
      this.map.spawns,
      this.map.rifts,
      this.traps,
      this.blockedSet,
      this.coin
    );
    if (!check.valid) {
      this.audio.playError();
      if (check.reason) {
        this.addFloatingText(gx + 0.5, gy + 0.5, 34, check.reason, '#ff6b5b', 0.95);
      }
      return null;
    }

    const spec = TRAP_SPECS[kind];
    this.coin -= spec.cost;

    const maxHp = kind === 'barricade' ? 420 : 100;
    const trap: PlacedTrap = {
      id: this.nextEntityId++,
      kind,
      gx,
      gy,
      wallFace: spec.surface === 'wall' ? wallFace : undefined,
      facing: check.facing ?? 'se',
      cooldownTimer: 0,
      activeAnim: 1,
      hp: maxHp,
      maxHp,
      placedDuringPrep: this.phase === 'prep',
      totalKills: 0,
      totalDamage: 0,
    };

    this.traps.push(trap);
    this.stats.trapsPlaced++;
    this.audio.playTrapPlace();
    this.spawnBurst(gx + 0.5, gy + 0.5, 14, spec.accentColor, 10, 1.5);
    this.addFloatingText(gx + 0.5, gy + 0.5, 28, `-${spec.cost}g`, '#f2c96b', 0.9);

    if (kind === 'barricade') {
      this.rebuildPathing();
    }

    this.hoverPreviewPaths = null;
    this.notifyHud();
    return trap;
  }

  public getTrapAtTile(gx: number, gy: number): PlacedTrap | null {
    // Prefer floor/blocker/ceiling traps on (gx, gy), then wall traps on (gx, gy)
    const direct = this.traps.find(
      (t) => t.gx === gx && t.gy === gy && TRAP_SPECS[t.kind].surface !== 'wall'
    );
    if (direct) return direct;
    return this.traps.find((t) => t.gx === gx && t.gy === gy) ?? null;
  }

  public inspectTrap(trapId: number | null): void {
    this.inspectedTrapId = trapId;
    if (trapId !== null) {
      this.selectedTrapKind = null;
      this.clearPlacementHover();
    }
    this.notifyHud();
  }

  public rotateInspectedTrap(): boolean {
    if (this.inspectedTrapId === null) return false;
    const trap = this.traps.find((t) => t.id === this.inspectedTrapId);
    if (!trap || trap.kind !== 'flip') return false;
    trap.facing = rotateCardinalDir(trap.facing);
    trap.activeAnim = 0.7;
    this.audio.playTrapPlace();
    this.notifyHud();
    return true;
  }

  public sellTrap(trapId: number): number {
    const idx = this.traps.findIndex((t) => t.id === trapId);
    if (idx === -1) return 0;
    const trap = this.traps[idx];
    const refund = getTrapSellRefund(trap, this.phase === 'prep');
    this.traps.splice(idx, 1);
    this.coin += refund;
    if (this.inspectedTrapId === trapId) {
      this.inspectedTrapId = null;
    }
    this.audio.playTrapSell();
    this.spawnBurst(trap.gx + 0.5, trap.gy + 0.5, 16, '#f2c96b', 10, 1.4);
    this.addFloatingText(trap.gx + 0.5, trap.gy + 0.5, 30, `+${refund}g`, '#ffd875', 1.0);
    if (trap.kind === 'barricade') {
      this.rebuildPathing();
    }
    this.notifyHud();
    return refund;
  }

  public startNextWave(): boolean {
    if (this.phase !== 'prep') return false;
    const waveDef = this.map.definition.waves[this.currentWaveIndex];
    if (!waveDef) return false;

    this.phase = 'wave';
    this.waveElapsed = 0;
    this.pendingSpawns = [];
    this.inspectedTrapId = null;

    // Lock in prep-placed traps so mid-wave sells refund 50%
    for (const t of this.traps) {
      t.placedDuringPrep = false;
    }

    const spawnCount = Math.max(1, this.map.spawns.length);
    let alt = 0;

    for (const group of waveDef.groups) {
      for (let i = 0; i < group.count; i++) {
        const spawnIndex =
          group.spawnIndex !== undefined
            ? group.spawnIndex % spawnCount
            : alt++ % spawnCount;
        this.pendingSpawns.push({
          spawnAt: group.delay + i * group.interval,
          kind: group.kind,
          spawnIndex,
        });
      }
    }
    this.pendingSpawns.sort((a, b) => a.spawnAt - b.spawnAt);

    this.audio.playWaveHorn();
    this.showBanner(
      waveDef.title,
      `${this.pendingSpawns.length} Orks incoming!`,
      2.6,
      'warning'
    );
    this.notifyHud();
    return true;
  }

  // --- Warmage Active Abilities ---

  public castArcaneBlast(): boolean {
    if (this.phase !== 'prep' && this.phase !== 'wave') return false;
    if (this.hero.blastCooldown > 0) return false;

    this.hero.blastCooldown = this.hero.blastMaxCooldown;
    this.hero.castAnim = 1;
    this.audio.playBlast();
    this.triggerShake(0.18, 6);

    // Aim toward current auto-aim target if present, else hero facing
    let dirX = this.hero.facingX;
    let dirY = this.hero.facingY;
    if (this.hero.targetEnemyId !== null) {
      const target = this.enemies.find(
        (e) => e.id === this.hero.targetEnemyId && !e.dead
      );
      if (target) {
        const dx = target.gx - this.hero.gx;
        const dy = target.gy - this.hero.gy;
        const d = Math.hypot(dx, dy);
        if (d > 0.01) {
          dirX = dx / d;
          dirY = dy / d;
          this.hero.facingX = dirX;
          this.hero.facingY = dirY;
        }
      }
    }

    const range = 3.2;
    this.rings.push({
      gx: this.hero.gx,
      gy: this.hero.gy,
      radius: 0.4,
      maxRadius: range,
      life: 0.34,
      maxLife: 0.34,
      color: '#ff9d3b',
      kind: 'blast',
      dirX,
      dirY,
    });

    for (let i = 0; i < 18; i++) {
      const spread = (Math.random() - 0.5) * 1.05;
      const cos = Math.cos(spread);
      const sin = Math.sin(spread);
      const px = dirX * cos - dirY * sin;
      const py = dirX * sin + dirY * cos;
      const spd = 3.2 + Math.random() * 3.8;
      this.particles.push({
        gx: this.hero.gx + dirX * 0.25,
        gy: this.hero.gy + dirY * 0.25,
        z: 18,
        vx: px * spd,
        vy: py * spd,
        vz: 35 + Math.random() * 65,
        life: 0.38,
        maxLife: 0.38,
        size: 4 + Math.random() * 3,
        color: i % 2 === 0 ? '#ffad42' : '#fff0b3',
        gravity: 160,
        glow: true,
      });
    }

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.gx - this.hero.gx;
      const dy = enemy.gy - this.hero.gy;
      const dist = Math.hypot(dx, dy);
      if (dist > range || dist < 0.001) continue;

      const dot = (dx / dist) * dirX + (dy / dist) * dirY;
      // Generous 110-degree cone (plus point-blank radius)
      if (dot < 0.32 && dist > 0.95) continue;

      tagEnemyCombo(enemy, 'blast', this.time);
      this.damageEnemy(enemy, 58, 'blast');

      if (!enemy.dead) {
        const spec = ENEMY_SPECS[enemy.kind];
        if (!spec.flipImmune) {
          enemy.airborne = true;
          enemy.vx = (dx / dist) * 4.4;
          enemy.vy = (dy / dist) * 4.4;
          enemy.vz = 175;
          enemy.z = Math.max(enemy.z, 2);
        } else {
          enemy.staggerTimer = Math.max(enemy.staggerTimer, 0.75);
        }
      }
    }

    this.notifyHud();
    return true;
  }

  public castFrostNova(): boolean {
    if (this.phase !== 'prep' && this.phase !== 'wave') return false;
    if (this.hero.frostCooldown > 0) return false;

    this.hero.frostCooldown = this.hero.frostMaxCooldown;
    this.hero.castAnim = 1;
    this.audio.playFrost();

    const radius = 2.95;
    this.rings.push({
      gx: this.hero.gx,
      gy: this.hero.gy,
      radius: 0.25,
      maxRadius: radius,
      life: 0.45,
      maxLife: 0.45,
      color: '#6ce2ff',
      kind: 'frost',
    });

    this.spawnBurst(this.hero.gx, this.hero.gy, 18, '#8be9ff', 22, 2.8);

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dist = Math.hypot(enemy.gx - this.hero.gx, enemy.gy - this.hero.gy);
      if (dist <= radius) {
        const freezeDur = enemy.kind === 'ogre' ? 1.35 : 2.35;
        enemy.freezeTimer = Math.max(enemy.freezeTimer, freezeDur);
        enemy.fuseTimer = 0; // Interrupts Sapper fuse!
        tagEnemyCombo(enemy, 'frost', this.time);
        this.damageEnemy(enemy, 28, 'frost');
      }
    }

    this.notifyHud();
    return true;
  }

  public castBlinkDash(): boolean {
    if (this.phase !== 'prep' && this.phase !== 'wave') return false;
    if (this.hero.dashCooldown > 0) return false;

    this.hero.dashCooldown = this.hero.dashMaxCooldown;
    this.hero.dashTimer = 0.19;

    // Dash along joystick direction if moving, else current facing
    let dx = this.moveInputX * 0.5 + this.moveInputY;
    let dy = -this.moveInputX * 0.5 + this.moveInputY;
    const len = Math.hypot(dx, dy);
    if (len > 0.05) {
      dx /= len;
      dy /= len;
    } else {
      dx = this.hero.facingX;
      dy = this.hero.facingY;
    }

    this.hero.dashDirX = dx;
    this.hero.dashDirY = dy;
    this.audio.playDash();

    this.rings.push({
      gx: this.hero.gx,
      gy: this.hero.gy,
      radius: 0.15,
      maxRadius: 0.9,
      life: 0.28,
      maxLife: 0.28,
      color: '#5df2d6',
      kind: 'dash',
    });
    this.spawnBurst(this.hero.gx, this.hero.gy, 16, '#5df2d6', 12, 1.8);

    this.notifyHud();
    return true;
  }

  // --- Core Fixed-Timestep Update ---

  public step(dt: number): void {
    if (this.phase === 'title' || this.paused) {
      this.time += dt;
      this.updateAmbientEffects(dt);
      return;
    }

    this.time += dt;
    if (this.phase === 'wave') {
      this.stats.elapsedSeconds += dt;
      this.waveElapsed += dt;
    }

    if (this.banner) {
      this.banner.timer -= dt;
      if (this.banner.timer <= 0) {
        this.banner = null;
      }
    }

    if (this.camera.shakeTime > 0) {
      this.camera.shakeTime = Math.max(0, this.camera.shakeTime - dt);
    }

    if (this.phase === 'prep' || this.phase === 'wave') {
      this.updateHero(dt);
      this.updateWaveSpawns();
      this.updateTraps(dt);
      this.updateScheduledArrows();
      this.updateProjectiles(dt);
      this.updateEnemies(dt);
      this.checkWaveCompletion();
    }

    this.updateAmbientEffects(dt);

    // Smooth camera follow during active wave if enabled
    if (this.camera.followHero && this.phase === 'wave') {
      const targetIso = gridToIso(this.hero.gx, this.hero.gy, 0);
      const lerp = 1 - Math.exp(-5.5 * dt);
      this.camera.x += (targetIso.x - this.camera.x) * lerp;
      this.camera.y += (targetIso.y - this.camera.y) * lerp;
    }

    this.hudDirtyAccum += dt;
    if (this.hudDirtyAccum >= 0.12) {
      this.hudDirtyAccum = 0;
      this.notifyHud();
    }
  }

  private updateHero(dt: number): void {
    const h = this.hero;
    h.attackCooldown = Math.max(0, h.attackCooldown - dt);
    h.blastCooldown = Math.max(0, h.blastCooldown - dt);
    h.frostCooldown = Math.max(0, h.frostCooldown - dt);
    h.dashCooldown = Math.max(0, h.dashCooldown - dt);
    h.recoilAnim = Math.max(0, h.recoilAnim - dt * 5.5);
    h.castAnim = Math.max(0, h.castAnim - dt * 3.5);

    if (h.dashTimer > 0) {
      h.dashTimer = Math.max(0, h.dashTimer - dt);
      if (Math.random() < 0.7) {
        this.particles.push({
          gx: h.gx,
          gy: h.gy,
          z: 18,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          vz: 18,
          life: 0.24,
          maxLife: 0.24,
          size: 4.5,
          color: '#5df2d6',
          gravity: 0,
          glow: true,
        });
      }
    }

    moveHeroScreenSpace(
      h,
      this.moveInputX,
      this.moveInputY,
      dt,
      this.map.grid,
      this.map.rows,
      this.map.cols
    );

    // Smart Auto-Aim Crossbow
    const target = pickSmartAutoAimTarget(
      h,
      this.enemies,
      this.traps,
      this.flowField.dist,
      this.map.grid,
      this.map.rows,
      this.map.cols
    );
    h.targetEnemyId = target ? target.id : null;

    if (target) {
      const dx = target.gx - h.gx;
      const dy = target.gy - h.gy;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.01) {
        h.facingX = dx / dist;
        h.facingY = dy / dist;
      }

      if (h.attackCooldown <= 0 && h.dashTimer <= 0) {
        h.attackCooldown = h.attackInterval;
        h.recoilAnim = 1;
        const speed = 13.5;
        this.projectiles.push({
          id: this.nextEntityId++,
          kind: 'hero_bolt',
          gx: h.gx + h.facingX * 0.28,
          gy: h.gy + h.facingY * 0.28,
          z: 22,
          vx: h.facingX * speed,
          vy: h.facingY * speed,
          damage: h.attackDamage,
          life: 0.65,
          pierceLeft: 1,
          hitIds: new Set(),
          sourceTag: 'hero_bolt',
        });
        this.audio.playBolt();
      }
    }
  }

  private updateWaveSpawns(): void {
    if (this.phase !== 'wave') return;
    while (
      this.pendingSpawns.length > 0 &&
      this.pendingSpawns[0].spawnAt <= this.waveElapsed
    ) {
      const next = this.pendingSpawns.shift()!;
      const spawnPos = this.map.spawns[next.spawnIndex] ?? this.map.spawns[0];
      if (!spawnPos) continue;
      const enemy = createEnemy(
        this.nextEntityId++,
        next.kind,
        spawnPos.gx,
        spawnPos.gy,
        this.currentWaveIndex
      );
      this.enemies.push(enemy);
      if (next.kind === 'ogre') {
        this.triggerShake(0.25, 5);
        this.showBanner('Armored Ogre!', 'Immune to Flip Traps — freeze & focus fire!', 2.2, 'warning');
      }
    }
  }

  private updateTraps(dt: number): void {
    for (const trap of this.traps) {
      trap.cooldownTimer = Math.max(0, trap.cooldownTimer - dt);
      trap.activeAnim = Math.max(0, trap.activeAnim - dt * 2.2);

      if (trap.kind === 'barricade') continue;

      if (trap.kind === 'tar') {
        for (const e of this.enemies) {
          if (e.dead || e.airborne) continue;
          if (Math.floor(e.gx) === trap.gx && Math.floor(e.gy) === trap.gy) {
            e.tarTimer = Math.max(e.tarTimer, 0.9);
            tagEnemyCombo(e, 'tar', this.time);
          }
        }
        continue;
      }

      if (trap.cooldownTimer > 0) continue;

      const spec = TRAP_SPECS[trap.kind];

      if (trap.kind === 'spikes') {
        const targets = this.enemies.filter(
          (e) =>
            !e.dead &&
            !e.airborne &&
            Math.hypot(e.gx - (trap.gx + 0.5), e.gy - (trap.gy + 0.5)) < 0.62
        );
        if (targets.length > 0) {
          trap.cooldownTimer = spec.cooldown;
          trap.activeAnim = 1;
          this.audio.playSpikes();
          for (const e of targets) {
            tagEnemyCombo(e, 'spikes', this.time);
            this.damageEnemy(e, spec.damage, 'spikes', trap);
          }
          this.spawnBurst(trap.gx + 0.5, trap.gy + 0.5, 10, '#e58765', 10, 1.4);
        }
      } else if (trap.kind === 'flip') {
        const targets = this.enemies.filter(
          (e) =>
            !e.dead &&
            !e.airborne &&
            Math.hypot(e.gx - (trap.gx + 0.5), e.gy - (trap.gy + 0.5)) < 0.56
        );
        if (targets.length > 0) {
          trap.cooldownTimer = spec.cooldown;
          trap.activeAnim = 1;
          this.audio.playFlip();
          const vec = CARDINAL_VECTORS[trap.facing];
          for (const e of targets) {
            tagEnemyCombo(e, 'flip', this.time);
            this.damageEnemy(e, spec.damage, 'flip', trap);
            if (!e.dead) {
              if (!ENEMY_SPECS[e.kind].flipImmune) {
                e.airborne = true;
                e.launchedByTrapId = trap.id;
                e.vx = vec.dx * 3.55 + (Math.random() - 0.5) * 0.25;
                e.vy = vec.dy * 3.55 + (Math.random() - 0.5) * 0.25;
                e.vz = 250;
                e.z = 3;
                e.fuseTimer = 0;
              } else {
                e.staggerTimer = Math.max(e.staggerTimer, 0.9);
                this.addFloatingText(e.gx, e.gy, 42, 'HEAVY!', '#ffba66', 0.85);
              }
            }
          }
          this.spawnBurst(trap.gx + 0.5, trap.gy + 0.5, 12, '#62dec4', 12, 1.8);
        }
      } else if (trap.kind === 'pounder') {
        const trigger = this.enemies.some(
          (e) =>
            !e.dead &&
            Math.hypot(e.gx - (trap.gx + 0.5), e.gy - (trap.gy + 0.5)) < 0.72
        );
        if (trigger) {
          trap.cooldownTimer = spec.cooldown;
          trap.activeAnim = 1;
          this.audio.playPounder();
          this.triggerShake(0.18, 5.5);
          this.rings.push({
            gx: trap.gx + 0.5,
            gy: trap.gy + 0.5,
            radius: 0.2,
            maxRadius: 1.05,
            life: 0.34,
            maxLife: 0.34,
            color: '#f07154',
            kind: 'pounder',
          });
          this.spawnBurst(trap.gx + 0.5, trap.gy + 0.5, 14, '#d9b58c', 16, 2.2);

          for (const e of this.enemies) {
            if (e.dead) continue;
            const d = Math.hypot(e.gx - (trap.gx + 0.5), e.gy - (trap.gy + 0.5));
            if (d <= 0.98) {
              tagEnemyCombo(e, 'pounder', this.time);
              e.staggerTimer = Math.max(e.staggerTimer, e.kind === 'ogre' ? 0.5 : 0.95);
              e.fuseTimer = 0;
              this.damageEnemy(e, spec.damage, 'pounder', trap);
            }
          }
        }
      } else if (trap.kind === 'arrow_wall' && trap.wallFace) {
        const dir = CARDINAL_VECTORS[trap.wallFace];
        const startX = trap.gx + 0.5 + dir.dx * 0.55;
        const startY = trap.gy + 0.5 + dir.dy * 0.55;

        // Check if any Ork is in front of the wall face (up to 5.5 tiles down the lane)
        const hasTargetInLane = this.enemies.some((e) => {
          if (e.dead) return false;
          const relX = e.gx - startX;
          const relY = e.gy - startY;
          const along = relX * dir.dx + relY * dir.dy;
          const perp = Math.abs(relX * -dir.dy + relY * dir.dx);
          return along > -0.1 && along < 5.5 && perp < 0.65;
        });

        if (hasTargetInLane) {
          trap.cooldownTimer = spec.cooldown;
          trap.activeAnim = 1;
          this.audio.playArrowWall();
          const boltSpeed = 12.5;
          // Staggered 5-arrow volley across the corridor width
          const offsets = [-0.26, -0.13, 0, 0.13, 0.26];
          offsets.forEach((off, idx) => {
            const perpX = -dir.dy * off;
            const perpY = dir.dx * off;
            this.scheduledArrows.push({
              fireAt: this.time + idx * 0.045,
              gx: startX + perpX,
              gy: startY + perpY,
              vx: dir.dx * boltSpeed,
              vy: dir.dy * boltSpeed,
              damage: spec.damage,
              trapId: trap.id,
            });
          });
        }
      }
    }
  }

  private updateScheduledArrows(): void {
    for (let i = this.scheduledArrows.length - 1; i >= 0; i--) {
      const a = this.scheduledArrows[i];
      if (a.fireAt <= this.time) {
        this.scheduledArrows.splice(i, 1);
        this.projectiles.push({
          id: this.nextEntityId++,
          kind: 'wall_arrow',
          gx: a.gx,
          gy: a.gy,
          z: 20,
          vx: a.vx,
          vy: a.vy,
          damage: a.damage,
          life: 0.62,
          pierceLeft: 3,
          hitIds: new Set(),
          sourceTag: 'arrow_wall',
          trapId: a.trapId,
        });
      }
    }
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.gx += p.vx * dt;
      p.gy += p.vy * dt;
      p.life -= dt;

      const cx = Math.floor(p.gx);
      const cy = Math.floor(p.gy);
      if (
        p.life <= 0 ||
        cx < 0 ||
        cy < 0 ||
        cx >= this.map.cols ||
        cy >= this.map.rows ||
        this.map.grid[cy][cx].type === 'wall'
      ) {
        if (cx >= 0 && cy >= 0 && cx < this.map.cols && cy < this.map.rows) {
          this.spawnBurst(p.gx, p.gy, p.z, '#f7d88a', 4, 0.9);
        }
        this.projectiles.splice(i, 1);
        continue;
      }

      const sourceTrap = p.trapId
        ? this.traps.find((t) => t.id === p.trapId)
        : undefined;

      for (const e of this.enemies) {
        if (e.dead || p.hitIds.has(e.id)) continue;
        const spec = ENEMY_SPECS[e.kind];
        const hitDist = spec.radius + 0.22;
        if (Math.hypot(e.gx - p.gx, e.gy - p.gy) <= hitDist) {
          p.hitIds.add(e.id);
          p.pierceLeft--;

          let dmg = p.damage;
          // Shielded Brute frontal resistance vs hero bolts (bypassed when frozen or flanked!)
          if (p.kind === 'hero_bolt' && spec.armorFront > 0 && e.freezeTimer <= 0) {
            const projLen = Math.hypot(p.vx, p.vy) || 1;
            const dot = (p.vx / projLen) * e.facingX + (p.vy / projLen) * e.facingY;
            if (dot < -0.2) {
              dmg = Math.round(dmg * (1 - spec.armorFront));
              this.addFloatingText(e.gx, e.gy, 34, 'SHIELD', '#a5bacf', 0.72);
            }
          }

          tagEnemyCombo(e, p.sourceTag, this.time);
          this.damageEnemy(e, dmg, p.sourceTag, sourceTrap);
          this.spawnBurst(
            e.gx,
            e.gy,
            e.z + 20,
            p.kind === 'hero_bolt' ? '#6ce2ff' : '#f4ba54',
            5,
            1.2
          );

          if (p.pierceLeft <= 0) {
            this.projectiles.splice(i, 1);
            break;
          }
        }
      }
    }
  }

  private updateEnemies(dt: number): void {
    const gravity = 620;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) {
        this.enemies.splice(i, 1);
        continue;
      }

      const spec = ENEMY_SPECS[e.kind];
      e.tarTimer = Math.max(0, e.tarTimer - dt);
      e.freezeTimer = Math.max(0, e.freezeTimer - dt);
      e.staggerTimer = Math.max(0, e.staggerTimer - dt);
      e.hitFlash = Math.max(0, e.hitFlash - dt * 5);
      e.attackCooldown = Math.max(0, e.attackCooldown - dt);

      // Airborne parabolic trajectory (Spring Flip Trap & Arcane Blast!)
      if (e.airborne) {
        const nextGx = e.gx + e.vx * dt;
        const nextGy = e.gy + e.vy * dt;
        const ncx = Math.floor(nextGx);
        const ncy = Math.floor(nextGy);

        // Bounce cleanly off solid walls rather than clipping outside the fortress
        if (
          ncx >= 0 &&
          ncy >= 0 &&
          ncx < this.map.cols &&
          ncy < this.map.rows &&
          this.map.grid[ncy][ncx].type !== 'wall' &&
          this.map.grid[ncy][ncx].type !== 'void'
        ) {
          e.gx = nextGx;
          e.gy = nextGy;
        } else {
          e.vx *= -0.35;
          e.vy *= -0.35;
        }

        e.vz -= gravity * dt;
        e.z += e.vz * dt;

        if (e.z <= 0) {
          e.z = 0;
          e.airborne = false;
          e.vx = 0;
          e.vy = 0;
          e.vz = 0;

          const landX = Math.max(0, Math.min(this.map.cols - 1, Math.floor(e.gx)));
          const landY = Math.max(0, Math.min(this.map.rows - 1, Math.floor(e.gy)));
          if (this.map.grid[landY][landX].type === 'lava') {
            tagEnemyCombo(e, 'lava', this.time);
            const sourceTrap = e.launchedByTrapId
              ? this.traps.find((t) => t.id === e.launchedByTrapId)
              : undefined;
            this.killEnemyInLava(e, sourceTrap);
            this.enemies.splice(i, 1);
            continue;
          }
          // Brief recovery stagger on hard landing
          e.staggerTimer = Math.max(e.staggerTimer, 0.25);
          e.launchedByTrapId = undefined;
        }
        continue;
      }

      // Check if somehow standing on Lava (e.g., pushed near edge)
      const curX = Math.max(0, Math.min(this.map.cols - 1, Math.floor(e.gx)));
      const curY = Math.max(0, Math.min(this.map.rows - 1, Math.floor(e.gy)));
      if (this.map.grid[curY][curX].type === 'lava') {
        tagEnemyCombo(e, 'lava', this.time);
        this.killEnemyInLava(e);
        this.enemies.splice(i, 1);
        continue;
      }

      // Check Rift breach!
      if (this.map.grid[curY][curX].type === 'rift') {
        e.dead = true;
        e.deathCause = 'rift';
        this.riftPoints = Math.max(0, this.riftPoints - spec.riftCost);
        this.audio.playRiftHit();
        this.triggerShake(0.26, 7);
        this.rings.push({
          gx: curX + 0.5,
          gy: curY + 0.5,
          radius: 0.2,
          maxRadius: 1.4,
          life: 0.45,
          maxLife: 0.45,
          color: '#ff5263',
          kind: 'rift',
        });
        this.addFloatingText(
          curX + 0.5,
          curY + 0.5,
          44,
          `-${spec.riftCost} RIFT`,
          '#ff5263',
          1.2
        );
        this.enemies.splice(i, 1);
        if (this.riftPoints <= 0) {
          this.phase = 'defeat';
          this.showBanner('The Rift Has Fallen!', 'Orks breached the fortress.', 4, 'warning');
          this.notifyHud();
          return;
        }
        this.notifyHud();
        continue;
      }

      // Frozen or staggered enemies cannot move or detonate
      if (e.freezeTimer > 0 || e.staggerTimer > 0) {
        continue;
      }

      // Sapper barricade sabotage AI!
      if (e.kind === 'sapper') {
        const targetBarricade = findNearestBarricade(e, this.traps, 5.5);
        if (targetBarricade) {
          const bDist = Math.hypot(
            targetBarricade.gx + 0.5 - e.gx,
            targetBarricade.gy + 0.5 - e.gy
          );
          if (bDist <= 0.92) {
            // Telegraph brief glowing fuse, then boom!
            e.fuseTimer += dt;
            if (e.fuseTimer >= 0.45) {
              this.detonateSapper(e, targetBarricade);
              this.enemies.splice(i, 1);
              continue;
            }
            continue;
          } else {
            e.fuseTimer = 0;
            const dx = (targetBarricade.gx + 0.5 - e.gx) / bDist;
            const dy = (targetBarricade.gy + 0.5 - e.gy) / bDist;
            const slowMult = e.tarTimer > 0 ? 0.45 : 1;
            const spd = spec.speed * slowMult;
            const nx = e.gx + dx * spd * dt;
            const ny = e.gy + dy * spd * dt;
            if (this.canEnemyStepTo(nx, e.gy)) e.gx = nx;
            if (this.canEnemyStepTo(e.gx, ny)) e.gy = ny;
            e.facingX = dx;
            e.facingY = dy;
            e.walkPhase += dt * spd * 6;
            continue;
          }
        }
      }

      // Standard Flow-Field navigation toward the Rift
      let moveX = this.flowField.dirX[curY][curX];
      let moveY = this.flowField.dirY[curY][curX];

      // Subtle center-lane pull so Orks flow cleanly around tight corners
      const tileCenterX = curX + 0.5;
      const tileCenterY = curY + 0.5;
      if (Math.abs(moveX) > Math.abs(moveY)) {
        moveY += (tileCenterY - e.gy) * 0.65;
      } else if (Math.abs(moveY) > Math.abs(moveX)) {
        moveX += (tileCenterX - e.gx) * 0.65;
      }

      // Gentle crowd separation so Orks look like a lively horde
      let sepX = 0;
      let sepY = 0;
      for (let j = 0; j < this.enemies.length; j++) {
        if (i === j) continue;
        const other = this.enemies[j];
        if (other.dead || other.airborne) continue;
        const dx = e.gx - other.gx;
        const dy = e.gy - other.gy;
        const dSq = dx * dx + dy * dy;
        const minSep = spec.radius + ENEMY_SPECS[other.kind].radius;
        if (dSq > 0.0001 && dSq < minSep * minSep) {
          const d = Math.sqrt(dSq);
          const push = (minSep - d) / minSep;
          sepX += (dx / d) * push * 0.9;
          sepY += (dy / d) * push * 0.9;
        }
      }

      moveX += sepX;
      moveY += sepY;
      const len = Math.hypot(moveX, moveY);
      if (len > 0.001) {
        moveX /= len;
        moveY /= len;
        e.facingX = moveX;
        e.facingY = moveY;
      }

      const slowMult = e.tarTimer > 0 ? 0.45 : 1;
      const spd = spec.speed * slowMult;
      const nextX = e.gx + moveX * spd * dt;
      const nextY = e.gy + moveY * spd * dt;

      if (this.canEnemyStepTo(nextX, e.gy)) {
        e.gx = nextX;
      }
      if (this.canEnemyStepTo(e.gx, nextY)) {
        e.gy = nextY;
      }
      e.walkPhase += dt * spd * 5.2;
    }
  }

  private canEnemyStepTo(gx: number, gy: number): boolean {
    const cx = Math.floor(gx);
    const cy = Math.floor(gy);
    return isWalkableForOrk(
      this.map.grid,
      this.map.rows,
      this.map.cols,
      cx,
      cy,
      this.blockedSet
    );
  }

  private detonateSapper(sapper: Enemy, barricade: PlacedTrap): void {
    sapper.dead = true;
    sapper.deathCause = 'sapper_self';

    this.audio.playExplosion();
    this.triggerShake(0.28, 7.5);
    this.rings.push({
      gx: barricade.gx + 0.5,
      gy: barricade.gy + 0.5,
      radius: 0.2,
      maxRadius: 1.35,
      life: 0.42,
      maxLife: 0.42,
      color: '#ff6c36',
      kind: 'explosion',
    });
    this.spawnBurst(barricade.gx + 0.5, barricade.gy + 0.5, 22, '#ff8938', 24, 3.0);

    const dmg = ENEMY_SPECS.sapper.barricadeDamage;
    barricade.hp -= dmg;
    this.addFloatingText(
      barricade.gx + 0.5,
      barricade.gy + 0.5,
      40,
      `-${dmg} BOOM!`,
      '#ff6e42',
      1.05
    );

    if (barricade.hp <= 0) {
      const idx = this.traps.indexOf(barricade);
      if (idx !== -1) this.traps.splice(idx, 1);
      if (this.inspectedTrapId === barricade.id) this.inspectedTrapId = null;
      this.stats.barricadesLost++;
      this.rebuildPathing();
      this.showBanner('Barricade Destroyed!', 'Ork route shifted!', 2.0, 'warning');
      this.notifyHud();
    }
  }

  public damageEnemy(
    enemy: Enemy,
    amount: number,
    _source: string,
    sourceTrap?: PlacedTrap
  ): void {
    if (enemy.dead || amount <= 0) return;
    enemy.hp -= amount;
    enemy.hitFlash = 1;
    if (sourceTrap) {
      sourceTrap.totalDamage += amount;
    }

    if (amount >= 40) {
      this.addFloatingText(
        enemy.gx,
        enemy.gy,
        enemy.z + 32,
        `${Math.round(amount)}`,
        '#fff2d6',
        amount >= 100 ? 1.0 : 0.8
      );
    }

    if (enemy.hp <= 0) {
      this.killEnemy(enemy, 'normal', sourceTrap);
    }
  }

  private killEnemyInLava(enemy: Enemy, sourceTrap?: PlacedTrap): void {
    this.audio.playLavaSplash();
    this.spawnBurst(enemy.gx, enemy.gy, 8, '#ff7b29', 18, 2.4);
    this.spawnBurst(enemy.gx, enemy.gy, 12, '#ffe066', 10, 1.8);
    this.stats.lavaKills++;
    this.coin += 25;
    this.addFloatingText(enemy.gx, enemy.gy, 34, 'LAVA KILL! +25g', '#ff9933', 1.08);
    this.killEnemy(enemy, 'lava', sourceTrap);
  }

  private killEnemy(
    enemy: Enemy,
    cause: 'normal' | 'lava',
    sourceTrap?: PlacedTrap
  ): void {
    if (enemy.dead) return;
    enemy.dead = true;
    enemy.deathCause = cause;

    const spec = ENEMY_SPECS[enemy.kind];
    this.stats.orksSlain++;
    this.coin += spec.coinReward;
    if (sourceTrap) {
      sourceTrap.totalKills++;
    }

    const comboCount = getActiveComboCount(enemy, this.time);
    const comboBonus = computeComboBonusCoin(comboCount);

    if (comboCount > this.stats.highestCombo) {
      this.stats.highestCombo = comboCount;
    }

    if (comboBonus > 0) {
      this.coin += comboBonus;
      this.stats.totalComboBonus += comboBonus;
      this.audio.playCombo(comboCount);
      this.addFloatingText(
        enemy.gx,
        enemy.gy,
        enemy.z + 48,
        `${comboCount}x COMBO! +${comboBonus}g`,
        '#ffd452',
        1.05 + Math.min(comboCount, 5) * 0.08
      );
    } else if (cause === 'normal') {
      this.addFloatingText(
        enemy.gx,
        enemy.gy,
        enemy.z + 28,
        `+${spec.coinReward}g`,
        '#f2c96b',
        0.82
      );
    }

    if (enemy.kind === 'ogre') {
      this.triggerShake(0.24, 6);
    }

    this.spawnBurst(enemy.gx, enemy.gy, enemy.z + 18, '#6fb55e', 10, 1.8);
  }

  private checkWaveCompletion(): void {
    if (this.phase !== 'wave') return;
    if (this.pendingSpawns.length > 0 || this.enemies.length > 0) return;

    const completedWave = this.map.definition.waves[this.currentWaveIndex];
    const bonus = completedWave?.bonusCoin ?? 250;
    this.coin += bonus;

    // Auto-repair surviving barricades between waves
    for (const t of this.traps) {
      if (t.kind === 'barricade') {
        t.hp = t.maxHp;
      }
      t.cooldownTimer = 0;
    }

    if (this.currentWaveIndex + 1 >= this.map.definition.waves.length) {
      this.phase = 'victory';
      this.audio.playVictory();
      this.showBanner(
        'Fortress Secured!',
        `Earned ${this.getSkullRating()} / 5 Skulls!`,
        5,
        'victory'
      );
      this.notifyHud();
      return;
    }

    this.currentWaveIndex++;
    this.phase = 'prep';
    this.audio.playTrapSell();
    this.showBanner(
      'Wave Cleared!',
      `+${bonus}g Bonus • Barricades Repaired`,
      3.0,
      'gold'
    );
    this.notifyHud();
  }

  public getSkullRating(): number {
    if (this.riftPoints >= this.maxRiftPoints) return 5;
    if (this.riftPoints >= Math.ceil(this.maxRiftPoints * 0.85)) return 4;
    if (this.riftPoints >= Math.ceil(this.maxRiftPoints * 0.65)) return 3;
    if (this.riftPoints >= Math.ceil(this.maxRiftPoints * 0.4)) return 2;
    return this.riftPoints > 0 ? 1 : 0;
  }

  public getRemainingWaveEnemies(): number {
    return this.pendingSpawns.length + this.enemies.length;
  }

  private updateAmbientEffects(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.gx += p.vx * dt;
      p.gy += p.vy * dt;
      p.vz -= p.gravity * dt;
      p.z = Math.max(0, p.z + p.vz * dt);
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.rings.splice(i, 1);
        continue;
      }
      const prog = 1 - r.life / r.maxLife;
      r.radius = r.maxRadius * (0.15 + 0.85 * prog);
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life -= dt;
      if (ft.life <= 0) {
        this.floatingTexts.splice(i, 1);
        continue;
      }
      ft.z += ft.vy * dt;
    }
  }

  public spawnBurst(
    gx: number,
    gy: number,
    z: number,
    color: string,
    count: number,
    spreadSpeed: number
  ): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = (0.35 + Math.random() * 0.65) * spreadSpeed;
      this.particles.push({
        gx,
        gy,
        z,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        vz: 45 + Math.random() * 90,
        life: 0.32 + Math.random() * 0.25,
        maxLife: 0.55,
        size: 2.5 + Math.random() * 3,
        color,
        gravity: 240,
      });
    }
  }

  public addFloatingText(
    gx: number,
    gy: number,
    z: number,
    text: string,
    color: string,
    scale = 1
  ): void {
    this.floatingTexts.push({
      gx,
      gy,
      z,
      text,
      color,
      scale,
      life: 1.05,
      maxLife: 1.05,
      vy: 30,
    });
  }

  public triggerShake(duration: number, intensity: number): void {
    this.camera.shakeTime = Math.max(this.camera.shakeTime, duration);
    this.camera.shakeIntensity = Math.max(this.camera.shakeIntensity, intensity);
  }

  public notifyHud(): void {
    if (this.onHudDirty) {
      this.onHudDirty();
    }
  }
}
