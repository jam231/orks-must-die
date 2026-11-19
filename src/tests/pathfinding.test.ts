import { describe, expect, it } from 'vitest';
import { MAPS, parseMap } from '../game/maps';
import {
  canBlockWithoutSealingPath,
  cellKey,
  computeFlowField,
  tracePreviewPaths,
} from '../game/pathfinding';

describe('pathfinding and anti-block validation', () => {
  it('ensures every spawn reaches a rift on all handcrafted maps', () => {
    for (const mapDef of MAPS) {
      const parsed = parseMap(mapDef);
      expect(parsed.spawns.length).toBeGreaterThan(0);
      expect(parsed.rifts.length).toBeGreaterThan(0);

      const field = computeFlowField(
        parsed.grid,
        parsed.rows,
        parsed.cols,
        parsed.rifts,
        new Set()
      );

      for (const spawn of parsed.spawns) {
        expect(Number.isFinite(field.dist[spawn.gy][spawn.gx])).toBe(true);
      }

      const preview = tracePreviewPaths(
        parsed.grid,
        parsed.rows,
        parsed.cols,
        parsed.spawns,
        field,
        new Set()
      );
      expect(preview.length).toBe(parsed.spawns.length);
      for (const path of preview) {
        const last = path[path.length - 1];
        expect(parsed.grid[last.gy][last.gx].type).toBe('rift');
      }
    }
  });

  it('allows funneling one bridge with Barricades but rejects sealing both bridges', () => {
    const parsed = parseMap(MAPS[0]); // The Sunken Hallway
    const blocked = new Set<string>();

    // Seal the 2-tile left bridge at (2,4) and (3,4) — right bridge (8..9, 4) still open!
    expect(
      canBlockWithoutSealingPath(
        parsed.grid,
        parsed.rows,
        parsed.cols,
        parsed.spawns,
        parsed.rifts,
        blocked,
        2,
        4
      )
    ).toBe(true);
    blocked.add(cellKey(2, 4));

    expect(
      canBlockWithoutSealingPath(
        parsed.grid,
        parsed.rows,
        parsed.cols,
        parsed.spawns,
        parsed.rifts,
        blocked,
        3,
        4
      )
    ).toBe(true);
    blocked.add(cellKey(3, 4));

    // Now block half of the right bridge at (8,4) — (9,4) still open
    expect(
      canBlockWithoutSealingPath(
        parsed.grid,
        parsed.rows,
        parsed.cols,
        parsed.spawns,
        parsed.rifts,
        blocked,
        8,
        4
      )
    ).toBe(true);
    blocked.add(cellKey(8, 4));

    // Blocking the final remaining bridge tile (9,4) must be REJECTED!
    expect(
      canBlockWithoutSealingPath(
        parsed.grid,
        parsed.rows,
        parsed.cols,
        parsed.spawns,
        parsed.rifts,
        blocked,
        9,
        4
      )
    ).toBe(false);
  });
});
