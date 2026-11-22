# VoxelForge: Grimdark — Cinematic 3D Sandbox

A lightweight voxel sandbox: Terraria-style build/fight loop in a full 3D world with
**smooth cinematic graphics** (PBR materials, real-time soft shadows, baked ambient
occlusion, ACES tone mapping, bloom, golden-hour lighting), a **grimdark 40k-inspired
theme**, and deep **wargear customization** (helmet → armour → weapon → servo-skull
companion). Built on Three.js, zero external art or audio assets — every texture (128px
procedural PBR atlas with normal + emissive maps), model, and sound effect is generated
in code.

## Play in the browser (dev)

```bash
npm install
npm run dev       # http://localhost:5173
```

## Ship it

```bash
npm run build       # static web build -> dist/  (~136 KB gzipped, deploy anywhere)
npm run app         # build + launch the desktop app (dev loop)
npm run app:build   # build + package the desktop app -> release/
```

The desktop app is packaged with **Neutralino** (uses the OS WebView — no bundled
Chromium): `release/voxelforge/voxelforge-win_x64.exe` + `resources.neu` is the whole
Windows app (~3 MB, ~20 MB RAM for the app process). Binaries for Linux/macOS are
generated alongside. Ship the two Windows files together (same folder).

## Controls

| Input | Action |
|-------|--------|
| `W A S D` + `SHIFT` | Move / sprint (FOV kick) |
| Mouse / `Space` | Look / jump (coyote time + jump buffering) |
| L-Click | Strike foes / mine (harder blocks take more hits) |
| R-Click | Place block (can't wall yourself in) |
| `1`–`8` / wheel | Select block |
| `C` | Wargear customization |
| `B` | Call / dismiss servo-skull |
| `M` | Sound on/off |
| `Esc` | Pause |

## Wargear (all data-driven in `src/loadout.js`)

- **Weapons** — Chainsword (fast, revs mid-swing), Power Sword (glowing blade), Thunder
  Hammer (huge damage + knockback), Power Fist, Omnissian Pick (best mining). Stats:
  damage, reach, swing speed, mining power, knockback, glow.
- **Helmets** — Scout Cowl, Aquila Helm, Terminator Helm, Psyker Hood (defense/HP/luck/reach).
- **Armour** — Carapace, Power Armour, Terminator Plate, Artificer (defense/HP/speed).
- **Servo-skulls** — Medicae (heals), Gun-Skull (auto-zaps enemies), Auspex (luck),
  Cherub (speed).
- Crit chance scales with luck; loadout persists in localStorage.

## Game systems

- Procedural grimdark world: gothic ruins, bone piles, ember veins, gnarled trees,
  dusk sky + moon, drifting embers.
- Enemies: plague slimes (hop, contact damage, knockback-able) and vex skulls
  (orbit-and-dive flyers). HP bars, kill-scaled spawn ramp, medi-pack drops.
- Game feel: acceleration curves, landing camera dip, strafe roll, weapon sway/bob,
  screen shake, hit-stop, hit markers, floating damage numbers, slash arcs, chunky
  voxel particles (single InstancedMesh), damage vignette.
- Audio: fully synthesized WebAudio (swings, impacts, footsteps, ambient wind) — no files.

## Architecture

```
src/
  main.js       game loop, states, DDA raycast, combat, mining hardness, pickups
  world.js      voxel grid, terrain + ruins, chunked meshing, groundYBelow queries
  player.js     AABB collision, movement feel, FPS viewmodel with per-weapon models
  entities.js   servo-skull + slime + vex skull (pooled zap line, disposal-safe)
  effects.js    particles, shake, hit-stop, damage numbers, slash arcs
  audio.js      procedural WebAudio synth SFX + ambient bed
  loadout.js    gear catalog + derived stats (add an item = append one object)
  textures.js   procedural 16x16 grimdark atlas + HUD swatches
  ui.js         HUD, hotbar, wargear menu, 16-bit paper-doll preview
neutralino.config.json   desktop app config (window, icon, packaging)
```
