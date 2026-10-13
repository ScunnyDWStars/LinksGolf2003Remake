import * as THREE from 'three';

/** Grainy grayscale tile multiplied over the terrain's vertex colours for a grass/sand texture. */
export function makeDetailTexture(size = 256, seed = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < size * size; i++) {
    const v = 214 + rnd() * 41;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Short blade strokes.
  for (let k = 0; k < 2600; k++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const l = 2 + rnd() * 4;
    ctx.strokeStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.14)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 2, y - l);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const waterUniforms = { uTime: { value: 0 } };

/** Direction to the sun, shared by water highlights. */
export const SUN_DIR = new THREE.Vector3(-0.45, 0.62, 0.35).normalize();

/**
 * Water: animated wave normals, Fresnel reflection of the sky with a hot sun glint (which blooms), colour that
 * deepens with depth, see-through shallows and foam where it meets the bank. Needs a per-vertex `aDepth`
 * (metres of water below the surface).
 */
export function makeWaterMaterial(deep = new THREE.Color('#0d3340'), shallow = new THREE.Color('#3c6e5e'), swell = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    uniforms: {
      uTime: waterUniforms.uTime,
      uDeep: { value: deep },
      uShallow: { value: shallow },
      uZenith: { value: new THREE.Color('#2f62a0') },
      uHorizon: { value: new THREE.Color('#8eb0cf') },
      uSun: { value: SUN_DIR },
      uSwell: { value: swell },
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    },
    vertexShader: /* glsl */ `
      attribute float aDepth;
      varying vec3 vWorld;
      varying float vDepth;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vDepth = aDepth;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uSwell;
      uniform vec3 uDeep, uShallow, uZenith, uHorizon, uSun;
      varying vec3 vWorld;
      varying float vDepth;
      #include <common>
      #include <fog_pars_fragment>
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      // Sum of directional waves with analytic slopes: smooth, no faceting.
      vec2 waveSlope(vec2 p) {
        vec2 g = vec2(0.0);
        float t = uTime;
        vec2 dirs[5];
        dirs[0] = vec2(0.86, 0.5); dirs[1] = vec2(-0.6, 0.8); dirs[2] = vec2(0.2, -0.98); dirs[3] = vec2(-0.95, -0.3); dirs[4] = vec2(0.5, -0.86);
        float lens[5];
        lens[0] = 7.0; lens[1] = 4.3; lens[2] = 2.6; lens[3] = 1.5; lens[4] = 0.9;
        for (int i = 0; i < 5; i++) {
          float L = lens[i] * uSwell;
          float k = 6.2831 / L;
          float a = 0.035 * L / (1.0 + float(i) * 0.6);
          float ph = dot(dirs[i], p) * k + t * sqrt(9.8 * k) * 0.6 + float(i) * 1.7;
          g += dirs[i] * (a * k * cos(ph));
        }
        return g;
      }
      void main() {
        vec2 p = vWorld.xz;
        float dist = length(cameraPosition - vWorld);
        vec2 g = waveSlope(p) * (1.0 / (1.0 + dist * 0.015));
        g += (vec2(noise(p * 2.3 + uTime * 0.3), noise(p * 2.3 - uTime * 0.27 + 7.0)) - 0.5) * 0.06 / (1.0 + dist * 0.05);
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        float h0 = noise(p * 0.8 + uTime * 0.1);
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 R = reflect(-V, N);
        float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
        vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.45));
        float s = max(dot(R, normalize(uSun)), 0.0);
        vec3 glint = vec3(1.0, 0.95, 0.85) * (pow(s, 700.0) * 18.0 + pow(s, 60.0) * 0.25);
        float d = max(vDepth, 0.0);
        vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 2.2, d));
        // Light filtering down shows a little brighter where it's shallow.
        body *= 0.75 + 0.25 * dot(N, normalize(uSun));
        vec3 col = mix(body, sky, fres) + glint;
        float foam = smoothstep(0.32, 0.0, d) * smoothstep(0.35, 0.75, noise(p * 3.0 + uTime * 0.4) + h0 * 0.4);
        col = mix(col, vec3(0.92, 0.95, 0.95), foam * 0.8);
        float alpha = mix(0.5, 0.96, smoothstep(0.0, 1.0, d)) + fres * 0.2;
        gl_FragColor = vec4(col, clamp(max(alpha, foam * 0.8), 0.0, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

/**
 * Soft drifting clouds, drawn as a transparent dome over the physical sky. Lit from the sun side so they
 * keep some shape.
 */
export function makeCloudMaterial(sunDir: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uSunDir: { value: sunDir.clone().normalize() },
      uTime: waterUniforms.uTime,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform float uTime;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        if (d.y < 0.01) discard;
        vec2 cp = d.xz / (d.y + 0.12) * 1.4 + vec2(uTime * 0.008, uTime * 0.002);
        float c = fbm(cp);
        float density = smoothstep(0.48, 0.78, c) * smoothstep(0.01, 0.22, d.y);
        // Thicker cloud is darker underneath; the side facing the sun is brighter.
        float sunSide = pow(max(dot(d, normalize(uSunDir)), 0.0), 3.0);
        float shade = mix(0.78, 1.15, smoothstep(0.5, 0.9, c)) + sunSide * 0.5;
        vec3 col = vec3(1.0, 0.985, 0.96) * shade * 1.6;
        gl_FragColor = vec4(col, density * 0.85);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
