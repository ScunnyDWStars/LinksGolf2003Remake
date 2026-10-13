# Greenside Classic

A browser golf game in the spirit of **Links 2003**, the classic PC golf sim, rebuilt for 2026 with
TypeScript and Three.js. It plays like the old games: a 3-click swing meter, an aim marker on the ground,
real ball physics, wind, and a putting grid. It needs no install and no plugins; open the page and tee off.

> This is an independent fan project. It uses **no** code, art, audio, course data or trademarks from
> Microsoft's *Links* series. The game name, the course, the visuals and the sounds are all original.
> Terrain, trees and water are generated in code, and the audio is synthesised with WebAudio.

## Features

- **Two original 18-hole, par-72 courses**:
  - **Cedar Ridge Country Club**: a parkland course over rolling hills. Fairways are lined with dense woods,
    and it has creeks, ponds, cart paths and elevated tees.
  - **Kestrel Dunes Golf Links**: a seaside links (6,871 yds) with dunes, pot bunkers, burns crossing the
    fairway, gorse, out-of-bounds stakes and blind tee shots.
- **The classic presentation**:
  - a broadcast camera behind and above the golfer
  - a hole banner and player card ("1st Shot · 389 yds")
  - a top-down hole map you can click to aim
  - a floating club tag beside the golfer ("Driver 252y")
  - spectators lining the tee and ringing the green
- **Classic 3-click swing**:
  1. Click to start the backswing.
  2. Click again to set power. You can overswing past 100%.
  3. Click a third time as the marker comes back through the snap line. Click early to hook, late to slice.
- **Mouse swing**: drag down to take the club back, then push up through the ball.
- **Power stroke** option: about 6% more distance in exchange for a tighter accuracy window.
- **Ball physics**: RK4 flight with drag, Magnus lift, spin decay and wind that varies with height. Bounce and
  roll depend on the surface; backspin checks the ball up on greens. The ball can clip trees, lip out, or drop
  into the cup.
- **Lies matter**: rough, deep fescue and bunkers cost distance and spin. They also add scatter, and a lie can
  produce a "flyer".
- **Shot shaping**: draw, fade, high, low and punch.
- **14-club bag**. Each club's carry is calibrated in the simulation; the driver carries about 250 yds. Power on
  the meter maps to distance, so 50% carries about half as far.
- **Cameras**:
  - hole flyovers
  - a behind-the-golfer address view
  - a TV-style landing cam, a chase cam or a tee cam while the ball is in the air
  - an overhead hole map
  - a dedicated putting view
- **Putting grid**: lines draped over the green, coloured by steepness, with dots that drift downhill so you
  can read the break.
- **Rules**: water penalty with a drop on the line of entry, out of bounds (stroke and distance), optional
  gimmes inside 2 ft, and a pick-up at 10 strokes.
- **Round types**: 18 holes, front 9, back 9, or a practice hole. Includes a classic scorecard (circles for
  birdies, boxes for bogeys) and saves your best scores.
- **Procedural audio**: club impacts, landings, splashes, the cup rattle, crowd applause, sea wind and birds.
- Works with keyboard and mouse, and on touch screens.

## Controls

| Action | Keys / mouse |
| --- | --- |
| Swing (3 clicks) | `Space` or left-click |
| Aim | `←` `→` (hold `Shift` for fine), right-click the ground, or click the hole map |
| Change club | `↑` `↓` or `Q` `E` |
| Putter range | `Z` `X` |
| Shot shape | `F` |
| Ball camera (TV / Chase / Tee) | `C` |
| Overhead map | `M` |
| Putting grid | `G` |
| Replay last shot | `R` |
| Scorecard | `Tab` |
| Pause / settings | `Esc` |
| Help | `H` |

On touch screens, tap to swing and press and hold the ground to aim. The on-screen buttons do the rest.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm test           # unit tests (physics, swing, course, rules)
npm run e2e        # Playwright smoke test: tees off and plays a full hole in Chromium
```

A push to `main` runs CI and publishes `dist/` to GitHub Pages. To turn this on, go to
*Settings → Pages → Source* and choose **GitHub Actions**.

## Code layout

```
src/
  physics/   ball flight (RK4, drag, lift, wind), bounce and roll, cup capture, shot simulator, surfaces table
  swing/     clubs, swing meter + mouse swing, shot shaping / lie effects, power→distance calibration
  course/    hole data types, Cedar Ridge + Kestrel Dunes, terrain heightfield + surface lookup, mesh builder
  render/    scene, sky & water shaders, golfer, gallery, ball/trail, aim marker, putting grid, camera director
  game/      game controller (state machine), rules, round scoring, settings persistence
  ui/        HUD, hole map, swing meter view, scorecard, menus
  audio/     WebAudio sound synthesis
  input/     keyboard, mouse and touch
tests/       Vitest unit tests
e2e/         Playwright smoke test
```

Each whole shot is simulated the moment the ball is struck, then played back in real time. That lets the
landing camera cut to where the ball will come down before it gets there, and it makes replays free.

Holes are written as data in "plan" coordinates: metres right of the tee line, and metres forward. The
terrain is built from that data: noise-based dunes, shaped tee and green pads, bunkers and water cut in.
It is sampled on a 1 m grid that both the renderer and the physics use, so the ball always sits on the
surface you see.
