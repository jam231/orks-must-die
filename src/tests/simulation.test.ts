import { describe, expect, it } from 'vitest';
import { computeComboBonusCoin, createEnemy, tagEnemyCombo } from '../game/enemies';
import { MAPS } from '../game/maps';
import { GameSimulation } from '../game/simulation';

describe('GameSimulation core gameplay mechanics', () => {
  it('places traps, deducts coin, and refunds 100% during prep vs 50% after wave starts', () => {
    const sim = new GameSimulation();
    sim.loadMap(MAPS[0], 'prep');
    const startCoin = sim.coin;

    const tar = sim.tryPlaceTrap('tar', 3, 6);
    expect(tar).not.toBeNull();
    expect(sim.coin).toBe(startCoin - 200);

    // 100% refund during prep
    const refundPrep = sim.sellTrap(tar!.id);
    expect(refundPrep).toBe(200);
    expect(sim.coin).toBe(startCoin);

    // Place spikes, start wave, then sell -> 50% refund
    const spikes = sim.tryPlaceTrap('spikes', 3, 6);
    expect(spikes).not.toBeNull();
    sim.startNextWave();
    const refundWave = sim.sellTrap(spikes!.id);
    expect(refundWave).toBe(150);
  });

  it('auto-faces Spring Flip Trap toward adjacent Lava and dunks Orks for an instant Lava Kill', () => {
    const sim = new GameSimulation();
    sim.loadMap(MAPS[0], 'prep');

    // Tile (3, 4) borders Lava at (4, 4) in 'se' (+gx) direction!
    const flip = sim.tryPlaceTrap('flip', 3, 4);
    expect(flip).not.toBeNull();
    expect(flip!.facing).toBe('se');

    sim.phase = 'wave';
    const ork = createEnemy(999, 'grunt', 3, 4, 0);
    ork.gx = 3.5;
    ork.gy = 4.5;
    sim.enemies.push(ork);

    // Run simulation for 1.5 seconds (90 ticks at 60Hz)
    for (let i = 0; i < 90; i++) {
      sim.step(1 / 60);
    }

    expect(sim.stats.lavaKills).toBeGreaterThanOrEqual(1);
    expect(sim.stats.orksSlain).toBeGreaterThanOrEqual(1);
  });

  it('awards escalating Combo bonus Coin for multi-source kills', () => {
    expect(computeComboBonusCoin(1)).toBe(0);
    expect(computeComboBonusCoin(2)).toBe(15);
    expect(computeComboBonusCoin(3)).toBe(40);
    expect(computeComboBonusCoin(4)).toBe(75);

    const sim = new GameSimulation();
    sim.loadMap(MAPS[0], 'wave');
    const coinBefore = sim.coin;

    const ork = createEnemy(777, 'grunt', 5, 6, 0);
    ork.gx = 5.5;
    ork.gy = 6.5;
    sim.enemies.push(ork);

    tagEnemyCombo(ork, 'tar', sim.time);
    tagEnemyCombo(ork, 'frost', sim.time);
    tagEnemyCombo(ork, 'spikes', sim.time);
    sim.damageEnemy(ork, 999, 'spikes');

    // Base Grunt reward (38g) + 3x Combo bonus (40g) = 78g!
    expect(sim.coin - coinBefore).toBe(78);
    expect(sim.stats.highestCombo).toBe(3);
    expect(sim.stats.totalComboBonus).toBe(40);
  });

  it('validates Arrow Wall wall-face mounting and Ceiling Pounder archway mounting', () => {
    const sim = new GameSimulation();
    sim.loadMap(MAPS[0], 'prep');

    // Arrow wall on exposed masonry face (1, 4, 'se') succeeds
    const arrowWall = sim.tryPlaceTrap('arrow_wall', 1, 4, 'se');
    expect(arrowWall).not.toBeNull();

    // Ceiling Pounder on archway tile (3, 5) succeeds, on non-archway tile (2, 5) fails
    const invalidPounder = sim.tryPlaceTrap('pounder', 2, 5);
    expect(invalidPounder).toBeNull();

    const validPounder = sim.tryPlaceTrap('pounder', 3, 5);
    expect(validPounder).not.toBeNull();
  });
});
