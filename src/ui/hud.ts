import { MAPS } from '../game/maps';
import { GameSimulation } from '../game/simulation';
import { getTrapSellRefund } from '../game/traps';
import { TRAP_ORDER, TRAP_SPECS, TrapKind } from '../game/types';

function trapSvgIcon(kind: TrapKind): string {
  switch (kind) {
    case 'barricade':
      return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#d99a56" stroke-width="2" stroke-linecap="round"><rect x="3" y="6" width="18" height="12" rx="2" fill="rgba(217,154,86,0.2)"/><path d="M5 6l14 12M19 6L5 18"/></svg>`;
    case 'tar':
      return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><ellipse cx="12" cy="14" rx="9" ry="5.5" fill="#2c3540" stroke="#7d90a8" stroke-width="1.8"/><circle cx="9.5" cy="13" r="1.6" fill="#9fb2c9"/><circle cx="15" cy="15" r="1.2" fill="#9fb2c9"/></svg>`;
    case 'spikes':
      return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#e6835c" stroke-width="1.8" stroke-linejoin="round"><path d="M3 19h18M5 19l2.5-10L10 19M9.5 19L12 7l2.5 12M14 19l2.5-10L19 19" fill="rgba(230,131,92,0.22)"/></svg>`;
    case 'arrow_wall':
      return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#f0bc54" stroke-width="2" stroke-linecap="round"><path d="M4 7h14m0 0l-3-3m3 3l-3 3M4 12h16m0 0l-3-3m3 3l-3 3M4 17h14"/></svg>`;
    case 'flip':
      return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#5de0c4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18h16M7 15l5-9 5 9M12 6v10"/></svg>`;
    case 'pounder':
      return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#ef7760" stroke-width="2" stroke-linecap="round"><path d="M4 5h16M12 5v4"/><rect x="6" y="9" width="12" height="9" rx="1.5" fill="rgba(239,119,96,0.22)"/><path d="M8 21h8"/></svg>`;
  }
}

function skullSvg(earned: boolean): string {
  return `<svg class="skull-icon ${earned ? 'earned' : ''}" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C7.03 2 3 5.8 3 10.5c0 2.75 1.38 5.2 3.53 6.74V20a1 1 0 0 0 1 1h1.5v-2h1.5v2h3v-2H15v2h1.5a1 1 0 0 0 1-1v-2.76C19.62 15.7 21 13.25 21 10.5 21 5.8 16.97 2 12 2zm-3.25 10.5a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5zm6.5 0a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5z"/></svg>`;
}

export class HudController {
  private root: HTMLElement;
  private sim: GameSimulation;
  private onRecenter: () => void;
  private onSelectMap: (mapIndex: number) => void;

  private lastSignature = '';

  constructor(
    root: HTMLElement,
    sim: GameSimulation,
    callbacks: {
      onRecenter: () => void;
      onSelectMap: (mapIndex: number) => void;
    }
  ) {
    this.root = root;
    this.sim = sim;
    this.onRecenter = callbacks.onRecenter;
    this.onSelectMap = callbacks.onSelectMap;

    this.root.addEventListener('click', this.onClick);
    this.render();
  }

  public render(): void {
    const sig = this.computeStateSignature();
    if (sig === this.lastSignature) return;
    this.lastSignature = sig;

    const sim = this.sim;

    if (sim.phase === 'title') {
      this.root.innerHTML = this.renderTitleScreen();
      return;
    }

    const totalWaves = sim.map.definition.waves.length;
    const waveNum = Math.min(totalWaves, sim.currentWaveIndex + 1);
    const remaining = sim.getRemainingWaveEnemies();

    const inspectedTrap =
      sim.inspectedTrapId !== null
        ? sim.traps.find((t) => t.id === sim.inspectedTrapId) ?? null
        : null;

    const blastCd = sim.hero.blastCooldown;
    const frostCd = sim.hero.frostCooldown;
    const dashCd = sim.hero.dashCooldown;

    this.root.innerHTML = `
      <header class="top-bar">
        <div class="stat-strip">
          <div class="stat-item stat-rift" title="Rift Integrity">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L5 12l7 10 7-10L12 2z"/></svg>
            <span>${sim.riftPoints}/${sim.maxRiftPoints}</span>
            <span class="stat-label">Rift</span>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-item stat-coin" title="Coin">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9"/></svg>
            <span>${sim.coin}g</span>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-item stat-wave" title="Wave Progress">
            <span>W${waveNum}/${totalWaves}</span>
            ${
              sim.phase === 'wave'
                ? `<span class="stat-label" style="color:#ff9e75">• ${remaining} left</span>`
                : `<span class="stat-label" style="color:#6be3c8">• Prep</span>`
            }
          </div>
        </div>

        <div class="top-actions">
          ${
            sim.phase === 'prep'
              ? `<button id="btn-start-wave" class="btn-wave-go" data-action="start-wave">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  Start Wave ${waveNum}
                </button>`
              : ''
          }
          <button id="btn-recenter" class="btn-icon ${sim.camera.followHero ? 'active' : ''}" data-action="recenter" title="Fit / Follow Camera" aria-label="Fit or follow camera">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
          </button>
          <button id="btn-mute" class="btn-icon" data-action="toggle-mute" title="Toggle Sound" aria-label="Toggle Sound">
            ${
              sim.audio.isMuted()
                ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M23 9l-6 6M17 9l6 6"/></svg>`
                : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>`
            }
          </button>
          <button id="btn-pause" class="btn-icon ${sim.paused ? 'active' : ''}" data-action="toggle-pause" title="Pause / Menu" aria-label="Pause Menu">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
          </button>
        </div>
      </header>

      ${
        sim.banner
          ? `<div class="wave-banner tone-${sim.banner.tone}">
              <div class="wave-banner-title">${sim.banner.text}</div>
              ${sim.banner.subtext ? `<div class="wave-banner-sub">${sim.banner.subtext}</div>` : ''}
            </div>`
          : ''
      }

      <aside class="ability-cluster" aria-label="Warmage Abilities">
        <button id="btn-ability-blast" class="ability-btn blast ${blastCd > 0 ? 'cooling' : ''}" data-action="ability-blast" title="Arcane Blast (Q) — Cone Knockback">
          <span class="ability-key">Q</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffad4d" stroke-width="2.2" stroke-linecap="round"><path d="M4 12h8M12 12l7-6M12 12l8 0M12 12l7 6"/></svg>
          <span class="ability-name">Blast</span>
          ${blastCd > 0 ? `<span class="ability-cd-mask">${blastCd.toFixed(1)}</span>` : ''}
        </button>

        <button id="btn-ability-frost" class="ability-btn frost ${frostCd > 0 ? 'cooling' : ''}" data-action="ability-frost" title="Frost Nova (E) — Freeze Nearby Orks">
          <span class="ability-key">E</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7ae8ff" stroke-width="2.1" stroke-linecap="round"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/></svg>
          <span class="ability-name">Frost</span>
          ${frostCd > 0 ? `<span class="ability-cd-mask">${frostCd.toFixed(1)}</span>` : ''}
        </button>

        <button id="btn-ability-dash" class="ability-btn dash ${dashCd > 0 ? 'cooling' : ''}" data-action="ability-dash" title="Blink Dash (Space)">
          <span class="ability-key">SPC</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#66f2d8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3L4 14h7l-1 7 9-11h-7l1-7z"/></svg>
          <span class="ability-name">Blink</span>
          ${dashCd > 0 ? `<span class="ability-cd-mask">${dashCd.toFixed(1)}</span>` : ''}
        </button>
      </aside>

      <footer class="bottom-dock-wrap">
        ${this.renderContextChip(inspectedTrap)}
        <nav class="trap-dock" aria-label="Trap Loadout">
          ${TRAP_ORDER.map((kind) => {
            const spec = TRAP_SPECS[kind];
            const selected = sim.selectedTrapKind === kind;
            const affordable = sim.coin >= spec.cost;
            const surfLabel =
              spec.surface === 'blocker'
                ? 'BLOCK'
                : spec.surface === 'ceiling'
                  ? 'ARCH'
                  : spec.surface.toUpperCase();
            return `
              <button
                id="trap-slot-${kind}"
                class="trap-slot ${selected ? 'selected' : ''} ${!affordable ? 'unaffordable' : ''}"
                data-action="select-trap"
                data-trap="${kind}"
                title="${spec.name} (${spec.cost}g) — ${spec.description}"
              >
                <span class="trap-slot-key">${spec.hotkey}</span>
                <span class="trap-slot-surface">${surfLabel}</span>
                <span class="trap-slot-icon">${trapSvgIcon(kind)}</span>
                <span class="trap-slot-name">${spec.shortName}</span>
                <span class="trap-slot-cost">${spec.cost}g</span>
              </button>
            `;
          }).join('')}
        </nav>
      </footer>

      ${sim.paused && (sim.phase === 'prep' || sim.phase === 'wave') ? this.renderPauseModal() : ''}
      ${sim.phase === 'victory' || sim.phase === 'defeat' ? this.renderEndModal() : ''}
    `;
  }

  private renderContextChip(
    inspectedTrap: ReturnType<GameSimulation['traps']['find']> | null
  ): string {
    const sim = this.sim;

    if (sim.selectedTrapKind) {
      const spec = TRAP_SPECS[sim.selectedTrapKind];
      return `
        <div class="context-chip">
          <span><strong>${spec.name}</strong> <span class="context-chip-desc">— ${spec.description}</span></span>
          <button class="chip-btn" data-action="cancel-trap">Done</button>
        </div>
      `;
    }

    if (inspectedTrap) {
      const spec = TRAP_SPECS[inspectedTrap.kind];
      const refund = getTrapSellRefund(inspectedTrap, sim.phase === 'prep');
      const extraInfo =
        inspectedTrap.kind === 'barricade'
          ? `HP ${Math.max(0, Math.round(inspectedTrap.hp))}/${inspectedTrap.maxHp}`
          : `${inspectedTrap.totalKills} kills`;
      return `
        <div class="context-chip">
          <span><strong>${spec.name}</strong> <span class="context-chip-desc">(${extraInfo})</span></span>
          ${
            inspectedTrap.kind === 'flip'
              ? `<button class="chip-btn primary" data-action="rotate-trap">Rotate</button>`
              : ''
          }
          <button class="chip-btn danger" data-action="sell-trap" data-trap-id="${inspectedTrap.id}">Sell +${refund}g</button>
          <button class="chip-btn" data-action="close-inspect">✕</button>
        </div>
      `;
    }

    return '';
  }

  private renderTitleScreen(): string {
    return `
      <div class="modal-backdrop">
        <section class="modal-card">
          <h1 class="hero-title">ORKS MUST DIE!</h1>
          <p class="hero-subtitle">
            Isometric Action Tower Defense — Funnel hordes with Barricades, chain brutal trap combos, and launch Orks into molten Lava.
          </p>

          <div class="map-grid">
            ${MAPS.map(
              (m, idx) => `
              <button id="map-card-${m.id}" class="map-card" data-action="play-map" data-map-index="${idx}">
                <div>
                  <div class="map-card-head">
                    <span class="map-card-title">${m.name}</span>
                    <span class="diff-tag ${m.difficulty === 'Warmage' ? 'warmage' : ''}">${m.difficulty}</span>
                  </div>
                  <p class="map-card-desc" style="margin-top:8px">${m.subtitle}</p>
                </div>
                <div class="map-card-meta">
                  <span>${m.waves.length} Waves • ${m.startingCoin}g Start</span>
                  <span>Defend →</span>
                </div>
              </button>
            `
            ).join('')}
          </div>

          <div class="controls-strip">
            <div>
              <strong>Touch (iPad / Phone)</strong>
              Left thumb joystick moves Warmage (auto-aims!). Tap a trap below, then tap/drag on glowing tiles. Two fingers pinch-zoom.
            </div>
            <div>
              <strong>Warmage Skills</strong>
              Tap Blast (knockback into Lava), Frost (freeze Sappers), and Blink Dash on the right thumb arc.
            </div>
            <div>
              <strong>Desktop Controls</strong>
              WASD move • 1–6 select traps • Q Blast • E Frost • Space Blink • G Start Wave • Scroll zoom.
            </div>
          </div>
        </section>
      </div>
    `;
  }

  private renderPauseModal(): string {
    return `
      <div class="modal-backdrop">
        <section class="modal-card compact">
          <h2 class="hero-title" style="font-size:1.6rem">Fortress Paused</h2>
          <p class="hero-subtitle" style="margin-bottom:18px">
            ${this.sim.map.definition.name} — Wave ${this.sim.currentWaveIndex + 1} of ${this.sim.map.definition.waves.length}
          </p>
          <div class="modal-btn-row">
            <button class="btn-primary-action" data-action="toggle-pause">Resume</button>
            <button class="btn-secondary-action" data-action="restart-map">Restart</button>
            <button class="btn-secondary-action" data-action="back-title">Fortresses</button>
          </div>
        </section>
      </div>
    `;
  }

  private renderEndModal(): string {
    const sim = this.sim;
    const isVictory = sim.phase === 'victory';
    const skulls = isVictory ? sim.getSkullRating() : 0;
    const curIdx = MAPS.findIndex((m) => m.id === sim.map.definition.id);
    const hasNext = isVictory && curIdx >= 0 && curIdx + 1 < MAPS.length;

    return `
      <div class="modal-backdrop">
        <section class="modal-card compact">
          <h2 class="hero-title" style="font-size:1.85rem;color:${isVictory ? '#ffe18c' : '#ff7b6b'}">
            ${isVictory ? 'FORTRESS SECURED!' : 'THE RIFT HAS FALLEN'}
          </h2>
          <p class="hero-subtitle" style="margin-bottom:8px">
            ${
              isVictory
                ? `${sim.map.definition.name} defended with ${sim.riftPoints}/${sim.maxRiftPoints} Rift Points.`
                : `Orks overwhelmed the Rift on Wave ${sim.currentWaveIndex + 1}.`
            }
          </p>

          <div class="skull-row" aria-label="Earned ${skulls} out of 5 skulls">
            ${[1, 2, 3, 4, 5].map((n) => skullSvg(n <= skulls)).join('')}
          </div>

          <div class="summary-stats">
            <div class="summary-stat-box">
              <div class="summary-stat-val">${sim.stats.orksSlain}</div>
              <div class="summary-stat-lbl">Orks Slain</div>
            </div>
            <div class="summary-stat-box">
              <div class="summary-stat-val" style="color:#ff9d42">${sim.stats.lavaKills}</div>
              <div class="summary-stat-lbl">Lava Dunks</div>
            </div>
            <div class="summary-stat-box">
              <div class="summary-stat-val" style="color:#ffe18c">${sim.stats.highestCombo}x</div>
              <div class="summary-stat-lbl">Best Combo</div>
            </div>
            <div class="summary-stat-box">
              <div class="summary-stat-val" style="color:#6ce2ff">+${sim.stats.totalComboBonus}g</div>
              <div class="summary-stat-lbl">Combo Bonus</div>
            </div>
          </div>

          <div class="modal-btn-row">
            ${
              hasNext
                ? `<button class="btn-primary-action" data-action="play-map" data-map-index="${curIdx + 1}">Next Fortress →</button>`
                : ''
            }
            <button class="${hasNext ? 'btn-secondary-action' : 'btn-primary-action'}" data-action="restart-map">Play Again</button>
            <button class="btn-secondary-action" data-action="back-title">Fortresses</button>
          </div>
        </section>
      </div>
    `;
  }

  private onClick = (e: MouseEvent): void => {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (!target) return;

    this.sim.audio.unlock();
    const action = target.dataset.action;

    switch (action) {
      case 'play-map': {
        const idx = Number(target.dataset.mapIndex ?? '0');
        this.onSelectMap(idx);
        break;
      }
      case 'start-wave':
        this.sim.startNextWave();
        break;
      case 'select-trap': {
        const kind = target.dataset.trap as TrapKind | undefined;
        if (kind) this.sim.selectTrapTool(kind);
        break;
      }
      case 'cancel-trap':
        this.sim.selectTrapTool(null);
        break;
      case 'rotate-trap':
        this.sim.rotateInspectedTrap();
        break;
      case 'sell-trap': {
        const id = Number(target.dataset.trapId);
        if (Number.isFinite(id)) this.sim.sellTrap(id);
        break;
      }
      case 'close-inspect':
        this.sim.inspectTrap(null);
        break;
      case 'ability-blast':
        this.sim.castArcaneBlast();
        break;
      case 'ability-frost':
        this.sim.castFrostNova();
        break;
      case 'ability-dash':
        this.sim.castBlinkDash();
        break;
      case 'recenter':
        this.onRecenter();
        break;
      case 'toggle-mute':
        this.sim.audio.toggleMute();
        this.sim.notifyHud();
        break;
      case 'toggle-pause':
        this.sim.paused = !this.sim.paused;
        this.sim.notifyHud();
        break;
      case 'restart-map': {
        const idx = MAPS.findIndex((m) => m.id === this.sim.map.definition.id);
        this.onSelectMap(Math.max(0, idx));
        break;
      }
      case 'back-title':
        this.sim.loadMap(this.sim.map.definition, 'title');
        this.onRecenter();
        break;
    }
  };

  private computeStateSignature(): string {
    const s = this.sim;
    const trap =
      s.inspectedTrapId !== null
        ? s.traps.find((t) => t.id === s.inspectedTrapId)
        : null;
    return [
      s.phase,
      s.paused ? 1 : 0,
      s.map.definition.id,
      s.riftPoints,
      s.coin,
      s.currentWaveIndex,
      s.getRemainingWaveEnemies(),
      s.selectedTrapKind ?? '',
      s.inspectedTrapId ?? '',
      trap ? `${Math.round(trap.hp)}:${trap.totalKills}:${trap.facing}` : '',
      Math.ceil(s.hero.blastCooldown * 10),
      Math.ceil(s.hero.frostCooldown * 10),
      Math.ceil(s.hero.dashCooldown * 10),
      s.audio.isMuted() ? 1 : 0,
      s.camera.followHero ? 1 : 0,
      s.banner ? `${s.banner.text}:${s.banner.subtext ?? ''}` : '',
    ].join('|');
  }
}
