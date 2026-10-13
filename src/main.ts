import './style.css';
import { Game } from './game/Game';
import { GameScene } from './render/Scene';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const scene = new GameScene(canvas);
const game = new Game(scene);

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  scene.render(now / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.body.dataset.ready = '1';

if (new URLSearchParams(location.search).has('test')) {
  (window as unknown as { __golf: unknown }).__golf = {
    swing: (power: number, accuracy = 0) => game.testSwing(power, accuracy),
    fastForward: () => game.testFastForward(),
    primary: () => game.primary(),
  };
}
