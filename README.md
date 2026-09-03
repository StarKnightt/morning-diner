# Morning Diner

A photoreal, fully procedural roadside diner in Three.js (Vite + TypeScript): every texture is
generated in Workers at boot, the room, counter, kitchen, lot, cars and the desert world outside
are built from code, lit by a two-sun rig with baked probes and a HDR post chain (haze, bloom,
MSAA 4×). Walk in, sit down, pour a coffee, look out through the blinds.

```
npm install && npx vite        # then open the printed URL, click to enter
npm run build                  # tsc --noEmit && vite build
node tools/shoot.mjs           # headless capture of the reference poses → shots/
```

## Controls

| Key | Action |
|---|---|
| `W A S D` / mouse | walk / look (click the canvas for pointer lock) |
| `Shift` | sprint |
| `Space` | hop |
| `E` | interact: open doors and cabinets, sit on a bench or stool, pour, drink |
| `Q` | stand up |
| `F` | tilt the blinds you are looking at |
| `[` / `]` | exposure −/+ |

## Lighting

The scene is lit with the 6:45 PM evening preset (golden hour, sun 9° up). `?ev=±n` in the URL
offsets the exposure by n stops (`[` `]` do the same live); see BUILD.md "Evening preset".

Build notes, per-system verification and the capture / bench harnesses: `BUILD.md`.
