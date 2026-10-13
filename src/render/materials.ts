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

/** Animated water with a fresnel sky reflection and moving glints. */
export function makeWaterMaterial(deep = new THREE.Color('#1a4552'), shallow = new THREE.Color('#2f7680')): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: waterUniforms.uTime,
      uDeep: { value: deep },
      uShallow: { value: shallow },
      uSky: { value: new THREE.Color('#bcd6ea') },
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    },
    fog: true,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uSky;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        vec2 p = vWorld.xz * 0.35;
        float n = noise(p + vec2(uTime * 0.35, uTime * 0.2)) * 0.6 + noise(p * 2.3 - vec2(uTime * 0.5, -uTime * 0.3)) * 0.4;
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - clamp(viewDir.y, 0.0, 1.0), 3.0);
        vec3 col = mix(uDeep, uShallow, n * 0.6);
        col = mix(col, uSky, clamp(fres * 0.55 + 0.04, 0.0, 0.6));
        float glint = smoothstep(0.82, 0.97, n) * 0.35;
        col += vec3(glint);
        gl_FragColor = vec4(col, 0.93);
        #include <fog_fragment>
        #include <colorspace_fragment>
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
