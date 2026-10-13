# Greenside Classic

A browser golf game in the spirit of **Links 2003**, the classic PC golf sim, rebuilt for 2026 with
TypeScript and Three.js. It plays like the old games: a 3-click swing meter, an aim marker on the ground,
real ball physics, wind, and a putting grid. It needs no install and no plugins; open the page and tee off.

> This is an independent fan project. It uses **no** code, art, audio, course data or trademarks from
> Microsoft's *Links* series. The game name, the course, the visuals and the sounds are all original.
> Terrain, trees and water are generated in code, and the audio is synthesised with WebAudio.

## Features

- **Real courses** from OpenStreetMap and public elevation data, the same ones as BackyardGolf:
  **Romanby Golf Club** (Northallerton), **the Old Course at St Andrews** and **Augusta National**.
  They have real greens, bunkers, water, woods and yardages, drawn in this game's style. More can be added
  (see "Adding a real course" below).
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
- **Current-generation graphics**, with the classic layout:
  - physical sky with drifting clouds
  - lighting from the sky
  - cascaded shadows
  - ambient occlusion, bloom, depth of field on flyovers, colour grading and anti-aliasing
  - 3D grass that sways in the wind
  - leaf-card trees
  - water with reflections, sun glints and shore foam
  - a jointed golfer with a real swing (hip and shoulder turn, wrist hinge, full finish)
  - spectators who applaud good shots
  - a broadcast-style shot tracer

  Everything is generated in code, with no image files. **Options → Graphics** offers Auto, Low, Medium,
  High and Ultra; Low is the original lighter look. Auto picks a preset for your device, and the game
  steps down one level by itself if frames start to lag. Add `?gfx=low` (or `medium`, `high`, `ultra`) to
  the URL to force one.
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

## Adding a real course

Many courses are already traced in OpenStreetMap: fairways, greens, bunkers, water, tees, and
`golf=hole` lines with par. Baking that data together with public elevation (AWS Terrain Tiles) gives
every hole of the course:

```bash
npx tsx scripts/course-request.ts "Old Course, St Andrews" 56.348 -2.811
# Open the printed overpass-turbo link, Export → "raw OSM data", save it as data/<id>-osm.json, then:
npx tsx scripts/bake-course.ts data/<id>-osm.json public/courses/<id>.json --course "Old Course"
npx tsx scripts/catalog.ts        # refresh the in-game course list
```

`--course` picks one course when several share the land. The bake prints par, yardage and any holes
missing from the map. Add the course's place name, and `"style": "links"` or `"parkland"` for the look,
to `pipeline/courses/catalog-meta.json` before running the catalog script. Course data from OpenStreetMap
is © OpenStreetMap contributors under the ODbL; the game shows the credit whenever a real course is played.

## Code layout

```
src/
  physics/   ball flight (RK4, drag, lift, wind), bounce and roll, cup capture, shot simulator, surfaces table
  swing/     clubs, swing meter + mouse swing, shot shaping / lie effects, power→distance calibration
  course/    shared hole interface, Cedar Ridge + Kestrel Dunes, authored and map-based terrain, mesh builder
  mapcourse/ BackyardGolf course format and the OpenStreetMap course baker
  render/    scene (sky, IBL, cascaded shadows), post FX, quality presets, terrain/grass/foliage/water shaders,
             golfer rig, gallery, ball & tracer, aim marker, putting grid, camera director
  game/      game controller (state machine), rules, round scoring, settings persistence
  ui/        HUD, hole map, swing meter view, scorecard, menus
  audio/     WebAudio sound synthesis
  input/     keyboard, mouse and touch
scripts/     course tools: fetch/bake OpenStreetMap courses, refresh the course list
tests/       Vitest unit tests
e2e/         Playwright smoke test
```

Each whole shot is simulated the moment the ball is struck, then played back in real time. That lets the
landing camera cut to where the ball will come down before it gets there, and it makes replays free.

Holes are written as data in "plan" coordinates: metres right of the tee line, and metres forward. The
terrain is built from that data: noise-based dunes, shaped tee and green pads, bunkers and water cut in.
It is sampled on a 1 m grid that both the renderer and the physics use, so the ball always sits on the
surface you see.
