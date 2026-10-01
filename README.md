# 🧱 Blocky Buddies

A tiny Roblox-like 3D sandbox game for kids ages 3–7. Explore a colorful blocky
island, build with blocks, collect stars, and say hi to the bunnies. No enemies,
no losing, no chat — just fun.

## Play it

Open `index.html` in a browser, or enable **GitHub Pages** (Settings → Pages →
Deploy from branch) for a free playable link. No build step needed.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move | WASD / arrow keys | Left joystick |
| Jump | Space | ⬆️ button |
| Place block | E | 🧱 button |
| Remove block | Q | ⛏️ button |

- Aim with the `+` crosshair in the center of the screen.
- Pick block colors from the palette at the bottom.
- ⭐ Walk into stars to collect them (progress is saved).
- Pick your buddy's color on the start screen (saved too).

## Tech

- [Three.js](https://threejs.org/) v0.160.0, vendored locally in `js/three.module.js` — 3D voxel world
- Vanilla JS + Web Audio API (all sounds are synthesized, zero audio files)
- No backend, no tracking, no multiplayer — works fully offline, no network requests at all

## Project structure

```
index.html        Start screen, HUD, touch controls
css/style.css     All styling (kid-friendly big buttons)
js/game.js        The whole game: world gen, avatar, physics, building, stars
```

## Kid-safety notes

- Single-player only, no network play or chat.
- The only network request is the Three.js CDN (can be vendored for full offline use).
- No fail states: the buddy can't get hurt, and there's a safety respawn.
