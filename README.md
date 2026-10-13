# sod-web-port

An unofficial, **bring-your-own-game** browser runtime for *Soul of Darkness*, the 2008
Gameloft action platformer for J2ME phones.

It runs the game's **original, unmodified code** in any modern browser — desktop or phone —
with no emulator and no Java at runtime. You supply your own copy of the game; this
repository contains only the code written to make it run on the web.

> [!IMPORTANT]
> **This repository contains no Gameloft code, graphics, music, text or game files**, and
> never should. *Soul of Darkness* is © 2008 Gameloft SA. This project is not affiliated
> with, endorsed by or sponsored by Gameloft. "Soul of Darkness" and "Gameloft" are used
> only to identify the game this runtime is compatible with.
>
> To use it you need your own legally obtained copy of the game file. The compiled output
> (`dist/`) contains that game, so **do not publish, host or share a build.** See
> [Legal](#legal).

## What it is

The original game is a J2ME *MIDlet*: Java bytecode written against the MIDP 2.0 phone
APIs (`Canvas`, `Graphics`, `Image`, `RecordStore`, `Player`, …). Browsers have none of
those, so this project:

1. **Compiles the game's original bytecode ahead of time to JavaScript** with
   [TeaVM](https://teavm.org). At runtime it is plain JS; Java's exact `int` / `long` /
   `byte` semantics, array bounds checks and exceptions are preserved.
2. **Re-implements the ~50 MIDP methods the game actually uses** on top of web platform
   APIs. This is the code in this repository.
3. **Wraps it in a web front end**: whole-pixel scaling, optional pixel-art smoothing and
   screen effects, keyboard controls, and touch controls for phones.

Nothing in the game is patched; every fix lives in the platform layer.

## Requirements

| Tool | Version | Notes |
|---|---|---|
| JDK | 11 or newer | build only (tested with 27) |
| Maven | 3.9+ | build only; fetches TeaVM 0.16.0 |
| Node.js | 18+ | only for the bundled static server; any static server works |
| The game | `SoulOfDarkness_HTC_P3450_EN_IGPL_EU_101_S8000.jar` | your own copy, v1.0.1, 240×320 touch build |

The build checks the file's SHA-256
(`3da9ea7f…e4bea4`, full value in [`game/README.md`](game/README.md)) and refuses anything
else. Other builds of the game differ internally and are not supported.

## Build and run

```sh
cp /path/to/your/SoulOfDarkness_HTC_P3450_EN_IGPL_EU_101_S8000.jar game/SoulOfDarkness.jar
mvn -q package          # -> dist/  (or: mvn -q package -Dgame.jar=/path/to/game.jar)
node serve.mjs          # -> http://localhost:8240/
```

Edits to files in `static/` only need copying: `cp static/* dist/` — no rebuild.

### Playing on a phone

```sh
node serve.mjs --lan    # also prints http://<your-LAN-IP>:8240/
```

Open the printed address on a phone on the same Wi-Fi. LAN mode lets anyone on that network
open the page, so use it only on a network you trust. On iPhone, use *Share → Add to Home
Screen* for full screen (Safari has no fullscreen API for pages), and note the silent switch
mutes web audio. Saves are per device.

`http://localhost:8240/?touch` previews the phone layout on a desktop.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move | `A` `D` / `←` `→` | drag the joystick sideways |
| Jump | `W` / `Space` / `↑` | joystick up, or **Jump** |
| Diagonal jump | `Q` / `E` | joystick up-left / up-right |
| Crouch | `S` / `↓` | joystick down |
| Attack | `J` (or `Z`) | **Attack** |
| Magic | `K` (or `X`) | **Magic** |
| Switch weapon | `L` (or `C`) | **Switch** |
| OK / Next — and on the upgrade screen, **hold** to fill the bar | `Enter` | **OK** |
| Pause menu | `P` | **OK** in gameplay |
| Back / open weapon upgrade | `Esc` / `U` / `Backspace` | **Back** |

Mouse clicks and taps on the game screen also reach the game's own touchscreen controls
(this is the touch build). Keys use physical positions, so the layout is the same on
AZERTY/QWERTZ keyboards. Bindings live in [`static/keymap.js`](static/keymap.js).

## Display options

From the settings bar (⚙ on phones), remembered per browser:

- **Size** — *Pixel-perfect* (whole device pixels per game pixel) or *Fill* (largest fit;
  default on phones).
- **Filter** — *Sharp* or *Smooth* (Scale2x/AdvMAME, run on the GPU, never invents colours).
- **Screen** — *Clean*, *LCD* (pixel grid) or *CRT* (scanlines + aperture mask).

## How it works

```
 your game.jar ──unzip──▶ original .class files + data ─┐
                                                        ├─ TeaVM AOT ─▶ dist/sod.js
 src/main/java/javax/microedition/**  (MIDP layer) ─────┘                    │
                                                                             ▼
 static/host.js ── canvas, input, text, WebAudio, localStorage ◀── calls via @JSBody
 static/display.js  WebGL2 output: Scale2x → sharp-bilinear upscale → LCD/CRT
 static/controls.js joystick + buttons     static/midi.js  MIDI synth
```

| Piece | File(s) | Notes |
|---|---|---|
| Entry point | `src/main/java/Launcher.java` | boots the MIDlet like a handset's app manager |
| Graphics | `lcdui/Graphics.java`, `Image.java` | software renderer on an ARGB `int[]`: exact clip, all 8 `drawRegion` transforms, alpha |
| PNG | `sodweb/PngDecoder.java` | synchronous decoder; MIDP's `createImage(byte[])` can't wait for the browser's async one |
| Text | `Font.java` + `host.js` | browser rasterises, Java blends with a hard threshold |
| Input | `Canvas.java`, `host.js`, `keymap.js`, `controls.js` | queued and delivered on the game thread before each frame; a press always lasts ≥ 1 frame because the game polls once per frame |
| Lifecycle | `lcdui/SystemEvents.java` | show/hide on its own thread; the game stops repainting while hidden, so it can't arrive through the frame loop |
| Context-aware OK | `sodweb/Input.java`, `Launcher.java` | `Enter`/**OK** is the left soft key, except on the upgrade screen where it is Fire (the bar fills while Fire is held) |
| Saves | `rms/RecordStore.java` | `localStorage`, key `sod.rms.<store>` |
| Audio | `sodweb/WebPlayer.java`, `host.js`, `midi.js` | WAV via `decodeAudioData`; MIDI through a small oscillator synth |
| Game data | `sodweb/GameResources.java` | tells TeaVM to embed the JAR's resource files so `getResourceAsStream` works |

## Status

Verified in Chrome on macOS: boot, menus, story, level 1 gameplay, keyboard, mouse/touch,
saving, sound, tab switching, all display modes, and the phone layouts (landscape and
portrait, in emulated viewports). Typical frame cost is 2–7 ms of a 50 ms budget.

Known limitations:

- Not yet tested on physical phones; feedback welcome.
- Music is a simple synth rather than the original handsets' wavetable sound.
- The game's own tutorial screens still describe phone controls.
- The game stays portrait 240×320; a true widescreen view would need a landscape build of
  the game.
- Only the one game build above is supported.

## Contributing

Pull requests that improve the runtime are welcome. Please **never** commit game files,
extracted assets, decompiled code, screenshots of the game or a built `dist/`. The
`.gitignore` blocks the usual suspects, but check `git status` before committing.

## Legal

- The source code in this repository is © 2026 Jubayer-cmd and released under the
  [MIT License](LICENSE). That license covers only this project's own code.
- *Soul of Darkness*, its code, graphics, music, text and trademarks are © Gameloft SA.
  None of it is included here, and nothing in this repository grants any right to it.
- This project is an independent, non-commercial interoperability effort for people who
  already own the game. It does not circumvent any copy protection.
- Do not host, publish or redistribute builds (`dist/`), because they contain the game.
- If you are a rights holder with a concern, please open an issue and it will be
  addressed promptly.
