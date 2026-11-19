import { describe, expect, it } from 'vitest';
import {
  getWallFaceQuad,
  gridToIso,
  isoToGrid,
  pickWallFace,
  screenToWorld,
  worldToScreen,
} from '../game/iso';
import { MAPS, parseMap } from '../game/maps';
import { CameraState } from '../game/types';

describe('isometric projection and picking', () => {
  it('round-trips grid coordinates to isometric world coordinates', () => {
    const samples = [
      { gx: 0, gy: 0 },
      { gx: 3.5, gy: 7.25 },
      { gx: 11.2, gy: 2.8 },
      { gx: 6, gy: 6 },
    ];
    for (const s of samples) {
      const iso = gridToIso(s.gx, s.gy, 0);
      const back = isoToGrid(iso.x, iso.y);
      expect(back.gx).toBeCloseTo(s.gx, 5);
      expect(back.gy).toBeCloseTo(s.gy, 5);
    }
  });

  it('round-trips world coordinates through screen camera transform', () => {
    const camera: CameraState = {
      x: 120,
      y: 260,
      zoom: 1.25,
      minZoom: 0.5,
      maxZoom: 1.8,
      followHero: false,
      shakeTime: 0,
      shakeIntensity: 0,
    };
    const screen = worldToScreen(42, 180, camera, 1024, 768);
    const back = screenToWorld(screen.x, screen.y, camera, 1024, 768);
    expect(back.x).toBeCloseTo(42, 5);
    expect(back.y).toBeCloseTo(180, 5);
  });

  it('picks exposed wall faces accurately for Arrow Wall placement', () => {
    const parsed = parseMap(MAPS[0]);
    // Wall (1, 4) borders left bridge floor (2, 4) on its 'se' face
    const seQuad = getWallFaceQuad(1, 4, 'se');
    const seMidX = (seQuad[0].x + seQuad[2].x) * 0.5;
    const seMidY = (seQuad[0].y + seQuad[2].y) * 0.5;

    const picked = pickWallFace(
      seMidX,
      seMidY,
      parsed.grid,
      parsed.rows,
      parsed.cols,
      (gx, gy, face) => gx === 1 && gy === 4 && face === 'se'
    );
    expect(picked).toEqual({ gx: 1, gy: 4, face: 'se' });

    // Wall (6, 7) borders south corridor floor (6, 8) on its 'sw' face
    const swQuad = getWallFaceQuad(6, 7, 'sw');
    const swMidX = (swQuad[0].x + swQuad[2].x) * 0.5;
    const swMidY = (swQuad[0].y + swQuad[2].y) * 0.5;
    const pickedSw = pickWallFace(
      swMidX,
      swMidY,
      parsed.grid,
      parsed.rows,
      parsed.cols,
      (gx, gy, face) => gx === 6 && gy === 7 && face === 'sw'
    );
    expect(pickedSw).toEqual({ gx: 6, gy: 7, face: 'sw' });
  });
});
