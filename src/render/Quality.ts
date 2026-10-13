/** Graphics presets. Low is the original look; Ultra is everything on at full resolution. */
export type GfxLevel = 'low' | 'medium' | 'high' | 'ultra';
export type GfxSetting = 'auto' | GfxLevel;
export const GFX_LEVELS: readonly GfxLevel[] = ['low', 'medium', 'high', 'ultra'];

export interface Quality {
  level: GfxLevel;
  /** Cap on devicePixelRatio. */
  pixelRatio: number;
  /** 0 = one plain shadow map around the action; otherwise cascaded shadows with this many cascades. */
  cascades: number;
  shadowSize: number;
  /** Post-processing chain (ambient occlusion, bloom, grading, anti-aliasing). */
  post: boolean;
  ao: boolean;
  bloom: boolean;
  /** Depth of field on flyovers and the holed-putt close-up. */
  dof: boolean;
  /** Multisampled scene target (instead of SMAA). */
  msaa: number;
  /** Grass blades around the camera: count, and radius in metres. 0 = none. */
  grass: number;
  grassRadius: number;
  /** Leaf-card canopies for near trees (else simple blob canopies). */
  leafCards: boolean;
}

const PRESETS: Record<GfxLevel, Quality> = {
  low: { level: 'low', pixelRatio: 1, cascades: 0, shadowSize: 2048, post: false, ao: false, bloom: false, dof: false, msaa: 0, grass: 0, grassRadius: 0, leafCards: false },
  medium: { level: 'medium', pixelRatio: 1.25, cascades: 2, shadowSize: 2048, post: true, ao: false, bloom: true, dof: false, msaa: 0, grass: 22000, grassRadius: 24, leafCards: true },
  high: { level: 'high', pixelRatio: 1.5, cascades: 3, shadowSize: 2048, post: true, ao: true, bloom: true, dof: true, msaa: 0, grass: 60000, grassRadius: 34, leafCards: true },
  ultra: { level: 'ultra', pixelRatio: 2, cascades: 4, shadowSize: 4096, post: true, ao: true, bloom: true, dof: true, msaa: 4, grass: 120000, grassRadius: 44, leafCards: true },
};

export function presetFor(level: GfxLevel): Quality {
  return { ...PRESETS[level] };
}

export interface DeviceInfo {
  /** Unmasked GPU renderer string, if the browser shares it. */
  gpu: string;
  touch: boolean;
  /** Screen size in CSS pixels. */
  width: number;
  height: number;
  /** navigator.hardwareConcurrency */
  cores: number;
}

/** Pick a sensible preset for the device. Phones and tablets get Medium; integrated laptops High; desktop GPUs Ultra. */
export function autoLevel(d: DeviceInfo): GfxLevel {
  const gpu = d.gpu.toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return 'low';
  const phone = d.touch && Math.min(d.width, d.height) < 900;
  if (phone) return 'medium';
  if (/rtx|radeon rx|geforce gtx 1[0-9]{3}|geforce gtx 9|quadro|apple m[2-9]|apple m1 (pro|max|ultra)|arc a[0-9]/.test(gpu)) return 'ultra';
  if (d.cores > 0 && d.cores <= 2) return 'medium';
  return 'high';
}

/** Setting + optional URL override (`?gfx=low`) -> the level to run. */
export function resolveLevel(setting: GfxSetting, override: string | null, device: DeviceInfo): GfxLevel {
  if (override && (GFX_LEVELS as readonly string[]).includes(override)) return override as GfxLevel;
  return setting === 'auto' ? autoLevel(device) : setting;
}

export function lowerLevel(level: GfxLevel): GfxLevel {
  const i = GFX_LEVELS.indexOf(level);
  return GFX_LEVELS[Math.max(0, i - 1)];
}

/**
 * Watches frame times. If frames stay slow (over `budgetMs`) for `windowS` seconds, it asks for one step
 * down in quality, then waits before judging again.
 */
export class FrameGovernor {
  private slowFor = 0;
  private cooldown = 4;

  constructor(
    public budgetMs = 28,
    public windowS = 3,
  ) {}

  /** Feed a frame's duration; returns true when quality should drop one step. */
  sample(dtMs: number): boolean {
    const dt = Math.min(dtMs, 250) / 1000;
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return false;
    }
    if (dtMs > this.budgetMs) this.slowFor += dt;
    else this.slowFor = Math.max(0, this.slowFor - dt * 2);
    if (this.slowFor >= this.windowS) {
      this.slowFor = 0;
      this.cooldown = 6;
      return true;
    }
    return false;
  }
}

/** Gather what we can about the device. */
export function detectDevice(gl: WebGLRenderingContext | WebGL2RenderingContext | null): DeviceInfo {
  let gpu = '';
  try {
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
  } catch {
    /* not shared */
  }
  return {
    gpu,
    touch: typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0,
    width: typeof screen !== 'undefined' ? screen.width : 1920,
    height: typeof screen !== 'undefined' ? screen.height : 1080,
    cores: typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4,
  };
}
