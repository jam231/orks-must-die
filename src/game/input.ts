import { isoToGrid, pickWallFace, screenToWorld } from './iso';
import { JoystickVisualState } from './renderer';
import { GameSimulation } from './simulation';
import { TRAP_ORDER, TRAP_SPECS, WallFace } from './types';

interface TrackedPointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
  pointerType: string;
  button: number;
  role: 'joystick' | 'place' | 'pan' | 'tap';
  moved: boolean;
}

export class InputController {
  private canvas: HTMLCanvasElement;
  private sim: GameSimulation;
  private getViewport: () => { width: number; height: number };

  private pointers = new Map<number, TrackedPointer>();
  private keys = new Set<string>();

  private joystickPointerId: number | null = null;
  private joystickOriginX = 0;
  private joystickOriginY = 0;
  private joystickKnobX = 0;
  private joystickKnobY = 0;
  private readonly joystickRadius = 56;
  private joyVecX = 0;
  private joyVecY = 0;

  private lastPinchDist: number | null = null;
  private lastPinchMidX = 0;
  private lastPinchMidY = 0;

  constructor(
    canvas: HTMLCanvasElement,
    sim: GameSimulation,
    getViewport: () => { width: number; height: number }
  ) {
    this.canvas = canvas;
    this.sim = sim;
    this.getViewport = getViewport;
    this.bindEvents();
  }

  public getJoystickVisual(): JoystickVisualState {
    return {
      active: this.joystickPointerId !== null,
      originX: this.joystickOriginX,
      originY: this.joystickOriginY,
      knobX: this.joystickKnobX,
      knobY: this.joystickKnobY,
      radius: this.joystickRadius,
    };
  }

  public syncMovementToSim(): void {
    let kx = 0;
    let ky = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ky -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ky += 1;

    if (kx !== 0 || ky !== 0) {
      const len = Math.hypot(kx, ky);
      this.sim.moveInputX = kx / len;
      this.sim.moveInputY = ky / len;
    } else {
      this.sim.moveInputX = this.joyVecX;
      this.sim.moveInputY = this.joyVecY;
    }
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private getCanvasPoint(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private pickTargetAtScreen(
    sx: number,
    sy: number,
    forWallTrap: boolean
  ): { gx: number; gy: number; wallFace?: WallFace } {
    const { width, height } = this.getViewport();
    const world = screenToWorld(sx, sy, this.sim.camera, width, height);

    if (forWallTrap) {
      const picked = pickWallFace(
        world.x,
        world.y,
        this.sim.map.grid,
        this.sim.map.rows,
        this.sim.map.cols,
        (gx, gy, face) => this.sim.isWallFaceOpenForPlacement(gx, gy, face)
      );
      if (picked) {
        return { gx: picked.gx, gy: picked.gy, wallFace: picked.face };
      }
      // Fallback: check any wall face so invalid-reason feedback still shows
      const anyWall = pickWallFace(
        world.x,
        world.y,
        this.sim.map.grid,
        this.sim.map.rows,
        this.sim.map.cols,
        () => true
      );
      if (anyWall) {
        return { gx: anyWall.gx, gy: anyWall.gy, wallFace: anyWall.face };
      }
    }

    const g = isoToGrid(world.x, world.y);
    return { gx: Math.floor(g.gx), gy: Math.floor(g.gy) };
  }

  private pickPlacedTrapAtScreen(sx: number, sy: number): number | null {
    const { width, height } = this.getViewport();
    const world = screenToWorld(sx, sy, this.sim.camera, width, height);

    // Check mounted Arrow Walls first so wall faces are tappable!
    const wallPick = pickWallFace(
      world.x,
      world.y,
      this.sim.map.grid,
      this.sim.map.rows,
      this.sim.map.cols,
      (gx, gy, face) =>
        this.sim.traps.some(
          (t) => t.kind === 'arrow_wall' && t.gx === gx && t.gy === gy && t.wallFace === face
        )
    );
    if (wallPick) {
      const found = this.sim.traps.find(
        (t) =>
          t.kind === 'arrow_wall' &&
          t.gx === wallPick.gx &&
          t.gy === wallPick.gy &&
          t.wallFace === wallPick.face
      );
      if (found) return found.id;
    }

    const g = isoToGrid(world.x, world.y);
    const gx = Math.floor(g.gx);
    const gy = Math.floor(g.gy);
    const trap = this.sim.getTrapAtTile(gx, gy);
    return trap ? trap.id : null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.sim.audio.unlock();
    if (this.sim.phase === 'title') return;

    const pt = this.getCanvasPoint(e);
    const { width } = this.getViewport();

    // Right-click on desktop cancels trap placement or starts camera pan
    if (e.pointerType === 'mouse' && e.button === 2) {
      if (this.sim.selectedTrapKind) {
        this.sim.selectTrapTool(null);
      } else {
        this.sim.inspectTrap(null);
      }
      const p: TrackedPointer = {
        id: e.pointerId,
        x: pt.x,
        y: pt.y,
        startX: pt.x,
        startY: pt.y,
        startTime: performance.now(),
        pointerType: e.pointerType,
        button: e.button,
        role: 'pan',
        moved: false,
      };
      this.pointers.set(e.pointerId, p);
      return;
    }

    // Middle-click mouse pans camera
    if (e.pointerType === 'mouse' && e.button === 1) {
      this.pointers.set(e.pointerId, {
        id: e.pointerId,
        x: pt.x,
        y: pt.y,
        startX: pt.x,
        startY: pt.y,
        startTime: performance.now(),
        pointerType: e.pointerType,
        button: e.button,
        role: 'pan',
        moved: false,
      });
      return;
    }

    let role: TrackedPointer['role'] = 'tap';

    if (this.sim.selectedTrapKind !== null) {
      role = 'place';
      const isWall = TRAP_SPECS[this.sim.selectedTrapKind].surface === 'wall';
      const target = this.pickTargetAtScreen(pt.x, pt.y, isWall);
      this.sim.setPlacementHover(target.gx, target.gy, target.wallFace);
    } else if (
      e.pointerType !== 'mouse' &&
      this.joystickPointerId === null &&
      pt.x < width * 0.44
    ) {
      // Dynamic floating virtual joystick on left thumb zone!
      role = 'joystick';
      this.joystickPointerId = e.pointerId;
      this.joystickOriginX = pt.x;
      this.joystickOriginY = pt.y;
      this.joystickKnobX = pt.x;
      this.joystickKnobY = pt.y;
      this.joyVecX = 0;
      this.joyVecY = 0;
    } else if (e.pointerType === 'mouse') {
      role = 'tap';
    } else {
      // Right-side single finger without trap tool: tap inspects trap, drag pans camera
      role = 'pan';
    }

    this.pointers.set(e.pointerId, {
      id: e.pointerId,
      x: pt.x,
      y: pt.y,
      startX: pt.x,
      startY: pt.y,
      startTime: performance.now(),
      pointerType: e.pointerType,
      button: e.button,
      role,
      moved: false,
    });

    // If two non-joystick fingers are active, initiate pinch-zoom!
    const pinchers = this.getPinchPointers();
    if (pinchers.length === 2) {
      this.lastPinchDist = Math.hypot(
        pinchers[1].x - pinchers[0].x,
        pinchers[1].y - pinchers[0].y
      );
      this.lastPinchMidX = (pinchers[0].x + pinchers[1].x) * 0.5;
      this.lastPinchMidY = (pinchers[0].y + pinchers[1].y) * 0.5;
      this.sim.clearPlacementHover();
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const pt = this.getCanvasPoint(e);
    const tracked = this.pointers.get(e.pointerId);

    // Desktop hover preview when no mouse button is pressed
    if (!tracked) {
      if (e.pointerType === 'mouse' && this.sim.selectedTrapKind !== null) {
        const isWall = TRAP_SPECS[this.sim.selectedTrapKind].surface === 'wall';
        const target = this.pickTargetAtScreen(pt.x, pt.y, isWall);
        this.sim.setPlacementHover(target.gx, target.gy, target.wallFace);
      }
      return;
    }

    const dx = pt.x - tracked.x;
    const dy = pt.y - tracked.y;
    tracked.x = pt.x;
    tracked.y = pt.y;
    if (Math.hypot(pt.x - tracked.startX, pt.y - tracked.startY) > 10) {
      tracked.moved = true;
    }

    // Check 2-finger pinch-zoom & pan first
    const pinchers = this.getPinchPointers();
    if (pinchers.length === 2) {
      const dist = Math.hypot(
        pinchers[1].x - pinchers[0].x,
        pinchers[1].y - pinchers[0].y
      );
      const midX = (pinchers[0].x + pinchers[1].x) * 0.5;
      const midY = (pinchers[0].y + pinchers[1].y) * 0.5;

      if (this.lastPinchDist && this.lastPinchDist > 12) {
        const factor = dist / this.lastPinchDist;
        this.sim.camera.zoom = Math.max(
          this.sim.camera.minZoom,
          Math.min(this.sim.camera.maxZoom, this.sim.camera.zoom * factor)
        );
        this.sim.camera.x -= (midX - this.lastPinchMidX) / this.sim.camera.zoom;
        this.sim.camera.y -= (midY - this.lastPinchMidY) / this.sim.camera.zoom;
        this.sim.camera.followHero = false;
      }
      this.lastPinchDist = dist;
      this.lastPinchMidX = midX;
      this.lastPinchMidY = midY;
      return;
    }

    if (tracked.role === 'joystick') {
      const ox = pt.x - this.joystickOriginX;
      const oy = pt.y - this.joystickOriginY;
      const dist = Math.hypot(ox, oy);
      const clamped = Math.min(dist, this.joystickRadius);
      if (dist > 0.001) {
        this.joystickKnobX = this.joystickOriginX + (ox / dist) * clamped;
        this.joystickKnobY = this.joystickOriginY + (oy / dist) * clamped;
        const norm = Math.max(0, (clamped - 6) / (this.joystickRadius - 6));
        this.joyVecX = (ox / dist) * norm;
        this.joyVecY = (oy / dist) * norm;
      } else {
        this.joyVecX = 0;
        this.joyVecY = 0;
      }
      return;
    }

    if (tracked.role === 'place' && this.sim.selectedTrapKind !== null) {
      const isWall = TRAP_SPECS[this.sim.selectedTrapKind].surface === 'wall';
      const target = this.pickTargetAtScreen(pt.x, pt.y, isWall);
      this.sim.setPlacementHover(target.gx, target.gy, target.wallFace);
      return;
    }

    if (tracked.role === 'pan' && tracked.moved) {
      this.sim.camera.x -= dx / this.sim.camera.zoom;
      this.sim.camera.y -= dy / this.sim.camera.zoom;
      this.sim.camera.followHero = false;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const tracked = this.pointers.get(e.pointerId);
    if (!tracked) return;

    const wasPinching = this.getPinchPointers().length >= 2;
    this.pointers.delete(e.pointerId);

    if (this.getPinchPointers().length < 2) {
      this.lastPinchDist = null;
    }

    if (tracked.role === 'joystick') {
      this.joystickPointerId = null;
      this.joyVecX = 0;
      this.joyVecY = 0;
      // Quick non-dragging tap on left side still inspects a trap!
      if (!tracked.moved && performance.now() - tracked.startTime < 260) {
        const trapId = this.pickPlacedTrapAtScreen(tracked.x, tracked.y);
        this.sim.inspectTrap(trapId);
      }
      return;
    }

    if (wasPinching) return;

    if (tracked.role === 'place' && this.sim.selectedTrapKind !== null) {
      const isWall = TRAP_SPECS[this.sim.selectedTrapKind].surface === 'wall';
      const target = this.pickTargetAtScreen(tracked.x, tracked.y, isWall);
      this.sim.tryPlaceTrap(
        this.sim.selectedTrapKind,
        target.gx,
        target.gy,
        target.wallFace
      );
      if (tracked.pointerType !== 'mouse') {
        this.sim.clearPlacementHover();
      }
      return;
    }

    // Tap (or non-dragged pan) selects/inspects an existing trap or dismisses inspector
    if (!tracked.moved && tracked.button === 0) {
      const trapId = this.pickPlacedTrapAtScreen(tracked.x, tracked.y);
      this.sim.inspectTrap(trapId);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    this.sim.camera.zoom = Math.max(
      this.sim.camera.minZoom,
      Math.min(this.sim.camera.maxZoom, this.sim.camera.zoom * factor)
    );
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    this.sim.audio.unlock();
    this.keys.add(e.code);

    if (this.sim.phase === 'title') return;

    // Trap hotkeys 1..6
    const digitMatch = /^Digit([1-6])$/.exec(e.code);
    if (digitMatch) {
      const idx = Number(digitMatch[1]) - 1;
      const kind = TRAP_ORDER[idx];
      if (kind) this.sim.selectTrapTool(kind);
      return;
    }

    switch (e.code) {
      case 'KeyQ':
        this.sim.castArcaneBlast();
        break;
      case 'KeyE':
        this.sim.castFrostNova();
        break;
      case 'Space':
        e.preventDefault();
        this.sim.castBlinkDash();
        break;
      case 'KeyG':
      case 'Enter':
        if (this.sim.phase === 'prep') {
          this.sim.startNextWave();
        }
        break;
      case 'KeyR':
        this.sim.rotateInspectedTrap();
        break;
      case 'Backspace':
      case 'Delete':
        if (this.sim.inspectedTrapId !== null) {
          this.sim.sellTrap(this.sim.inspectedTrapId);
        }
        break;
      case 'Escape':
        if (this.sim.selectedTrapKind) {
          this.sim.selectTrapTool(null);
        } else if (this.sim.inspectedTrapId !== null) {
          this.sim.inspectTrap(null);
        } else if (this.sim.phase === 'prep' || this.sim.phase === 'wave') {
          this.sim.paused = !this.sim.paused;
          this.sim.notifyHud();
        }
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private getPinchPointers(): TrackedPointer[] {
    const out: TrackedPointer[] = [];
    for (const p of this.pointers.values()) {
      if (p.pointerType !== 'mouse' && p.role !== 'joystick') {
        out.push(p);
      }
    }
    return out;
  }
}
