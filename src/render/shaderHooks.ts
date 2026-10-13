import type * as THREE from 'three';

type Hook = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

/**
 * Several systems patch the same built-in materials (cascaded shadows, terrain detail, wind sway).
 * Material.onBeforeCompile holds one function, so hooks are kept in a list and run in order.
 */
export function addShaderHook(m: THREE.Material, key: string, hook: Hook): void {
  const hooks: { key: string; hook: Hook }[] = (m.userData.shaderHooks ??= []);
  const existing = hooks.findIndex((h) => h.key === key);
  if (existing >= 0) hooks[existing] = { key, hook };
  else hooks.push({ key, hook });
  m.onBeforeCompile = (s, r) => {
    for (const h of m.userData.shaderHooks as { hook: Hook }[]) h.hook(s, r);
  };
  m.customProgramCacheKey = () => (m.userData.shaderHooks as { key: string }[]).map((h) => h.key).join('|');
  m.needsUpdate = true;
}

export function removeShaderHook(m: THREE.Material, key: string): void {
  const hooks: { key: string }[] | undefined = m.userData.shaderHooks;
  if (!hooks) return;
  const i = hooks.findIndex((h) => h.key === key);
  if (i < 0) return;
  hooks.splice(i, 1);
  m.needsUpdate = true;
}
