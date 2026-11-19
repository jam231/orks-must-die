# Orks Must Die!

An isometric 2.5D browser action tower-defense game built with **Vite + TypeScript + HTML5 Canvas**, designed for touch play on **iPad** and **Android phones** as well as desktop browsers.

## Play Online

Hosted via GitHub Pages: **https://jam231.github.io/orks-must-die/**

## Features

- **Action + Tower Defense Hybrid**: Control the Warmage with smart auto-aim Arcane Crossbow bolts, **Arcane Blast** (cone knockback into Lava), **Frost Nova** (radial freeze), and **Blink Dash**.
- **6 Signature Traps**:
  - **Oak Barricade** — Reroutes Ork pathfinding with real-time path preview and anti-block protection.
  - **Tar Pit** — Slows Orks by 55% and adds a Combo stack.
  - **Floor Spikes** — Piercing floor burst.
  - **Arrow Wall** — Mounts on exposed masonry walls and fires a 5-bolt piercing volley across the corridor.
  - **Spring Flip Trap** — Launches Orks airborne into Lava for instant kills (auto-faces nearby Lava; tap placed trap to rotate).
  - **Ceiling Pounder** — Mounts under stone archways for heavy AoE crush + stun.
- **5 Ork Archetypes**: Ork Grunt, Kobold Runner, Ork Sapper (targets Barricades), Shielded Brute, and Armored Ogre.
- **2 Handcrafted Fortresses**: *The Sunken Hallway* (5 waves) and *Twin Gates Bastion* (7 waves, dual Spawn Portals).
- **Procedural Web Audio SFX** with automatic mobile Safari unlock and mute toggle.

## Controls

- **iPad / Android Phone**:
  - **Left thumb drag**: Dynamic floating virtual joystick to move the Warmage (auto-aims nearest priority Ork).
  - **Bottom Trap Dock**: Tap a trap, then tap or drag on glowing valid tiles/wall faces to place. Tap an existing trap to rotate or sell.
  - **Right thumb arc**: Tap **Blast**, **Frost**, and **Blink**.
  - **Two fingers**: Pinch-to-zoom and pan camera.
- **Desktop**:
  - `WASD` / Arrow keys: Move
  - `1–6`: Select trap • Left-click: Place / Inspect • Right-click / `Esc`: Cancel
  - `Q`: Arcane Blast • `E`: Frost Nova • `Space`: Blink Dash
  - `G` / `Enter`: Start Wave • `R`: Rotate Flip Trap • `Delete`: Sell • Scroll: Zoom

## Local Development

```bash
npm install
npm run dev
```

Run tests and production build:

```bash
npm test
npm run build
```
