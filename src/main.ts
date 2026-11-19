import './styles/main.css';
import { InputController } from './game/input';
import { MAPS } from './game/maps';
import { IsoRenderer } from './game/renderer';
import { GameSimulation } from './game/simulation';
import { HudController } from './ui/hud';

function bootstrap(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const hudRoot = document.getElementById('hud-root');
  if (!canvas || !hudRoot) {
    throw new Error('Missing #game-canvas or #hud-root element');
  }

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    throw new Error('Failed to obtain 2D canvas context');
  }

  const sim = new GameSimulation();
  const renderer = new IsoRenderer();

  let viewportW = window.innerWidth;
  let viewportH = window.innerHeight;

  const resizeCanvas = (refitCamera = false): void => {
    viewportW = Math.max(320, window.innerWidth);
    viewportH = Math.max(320, window.innerHeight);
    const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const maxDpr = isCoarsePointer ? 1.5 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    canvas.width = Math.round(viewportW * dpr);
    canvas.height = Math.round(viewportH * dpr);
    canvas.style.width = `${viewportW}px`;
    canvas.style.height = `${viewportH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (refitCamera) {
      sim.fitCameraToViewport(viewportW, viewportH);
    }
  };

  resizeCanvas(true);

  const input = new InputController(canvas, sim, () => ({
    width: viewportW,
    height: viewportH,
  }));

  const hud = new HudController(hudRoot, sim, {
    onRecenter: () => {
      if (sim.phase === 'wave' && !sim.camera.followHero) {
        sim.recenterCamera(viewportW, viewportH);
      } else {
        sim.camera.followHero = false;
        sim.fitCameraToViewport(viewportW, viewportH);
      }
      sim.notifyHud();
    },
    onSelectMap: (mapIndex: number) => {
      const def = MAPS[mapIndex] ?? MAPS[0];
      sim.loadMap(def, 'prep');
      sim.fitCameraToViewport(viewportW, viewportH);
      hud.render();
    },
  });

  sim.onHudDirty = () => hud.render();

  window.addEventListener('resize', () => {
    resizeCanvas(sim.phase === 'title' || sim.phase === 'prep');
  });

  // Expose simulation hook for debugging/automated smoke checks
  (window as unknown as { __ORKS_SIM__?: GameSimulation }).__ORKS_SIM__ = sim;

  const FIXED_DT = 1 / 60;
  let accumulator = 0;
  let lastTs = performance.now();

  const frame = (now: number): void => {
    const rawDt = Math.min(0.1, (now - lastTs) / 1000);
    lastTs = now;
    accumulator += rawDt;

    input.syncMovementToSim();

    while (accumulator >= FIXED_DT) {
      sim.step(FIXED_DT);
      accumulator -= FIXED_DT;
    }

    renderer.render(ctx, sim, viewportW, viewportH, input.getJoystickVisual());
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

bootstrap();
