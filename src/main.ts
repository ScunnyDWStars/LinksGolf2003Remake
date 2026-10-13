import './style.css';
import { Game } from './game/Game';
import { loadSettings } from './game/Settings';
import { detectDevice, presetFor, resolveLevel } from './render/Quality';
import { GameScene } from './render/Scene';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);
const gfxOverride = params.get('gfx');
const probe = document.createElement('canvas').getContext('webgl2');
const device = detectDevice(probe);
const level = resolveLevel(loadSettings().graphics, gfxOverride, device);
const scene = new GameScene(canvas, presetFor(level));
const game = new Game(scene, { device, gfxOverride });

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  scene.render(now / 1000, dt);
  game.afterFrame(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.body.dataset.ready = '1';

if (params.has('test')) {
  (window as unknown as { __golf: unknown }).__golf = {
    swing: (power: number, accuracy = 0) => game.testSwing(power, accuracy),
    fastForward: () => game.testFastForward(),
    primary: () => game.primary(),
    pose: (p: number) => game.testPose(p),
  };
}
