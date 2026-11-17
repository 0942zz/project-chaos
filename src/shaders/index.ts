import * as THREE from 'three'

/** Giant LED wall: individually visible diodes with flowing chevrons and radial pulses. */
export function createLedWallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uA: { value: new THREE.Color('#8a5a1c') },
      uB: { value: new THREE.Color('#f5c867') },
      uPower: { value: 0.6 },
      uSpeed: { value: 1 },
      uCells: { value: new THREE.Vector2(220, 46) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime, uPower, uSpeed;
      uniform vec3 uA, uB;
      uniform vec2 uCells;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec2 g = vUv * uCells;
        vec2 id = floor(g);
        vec2 f = fract(g) - 0.5;
        vec2 uv = (id + 0.5) / uCells;
        float x = abs(uv.x - 0.5) * 2.0;
        float t = uTime * uSpeed;
        float chev = smoothstep(0.55, 1.0, sin((x * 9.0 + abs(uv.y - 0.5) * 3.0 - t * 1.4) * 3.14159));
        float columns = smoothstep(0.2, 0.9, sin(uv.x * 60.0 + t * 0.6) * 0.5 + 0.5) * smoothstep(0.0, 1.0, 1.0 - abs(uv.y - 0.5) * 2.0);
        float eq = step(uv.y, 0.12 + 0.3 * hash(vec2(id.x, floor(t * 3.0))) * (0.4 + 0.6 * sin(uv.x * 12.0 + t) * 0.5 + 0.3));
        float sparkle = step(0.992, hash(id + floor(t * 8.0)));
        float sweep = (1.0 - smoothstep(0.0, 0.08, abs(fract(uv.x * 0.5 + uv.y * 0.15 - t * 0.12) - 0.5) - 0.02));
        vec3 col = uA * (0.12 + 0.5 * columns + 0.6 * eq) + uB * (chev * 0.85 + sweep * 0.8) + vec3(1.0) * sparkle;
        float dotMask = (1.0 - smoothstep(0.2, 0.46, length(f)));
        float vign = smoothstep(0.0, 0.2, uv.y) * (1.0 - smoothstep(0.85, 1.0, uv.y));
        gl_FragColor = vec4(col * dotMask * uPower * (0.35 + 0.65 * vign), 1.0);
      }
    `,
  })
}

/** Additive light shaft for the moving-head spotlights ("volumetric-style"). */
export function createBeamMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: 0.5 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      uniform vec3 uColor; uniform float uPower;
      void main() {
        // Clamp before pow(): interpolated values can stray just outside [0,1] and pow() of a negative is NaN.
        float rim = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.6);
        float along = pow(clamp(vUv.y, 0.0, 1.0), 1.7);
        gl_FragColor = vec4(uColor, clamp(rim * along * uPower, 0.0, 1.0));
      }
    `,
  })
}

/** Concentric animated energy rings for arena floors. */
export function createRingFloorMaterial(a: string, b: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    toneMapped: false,
    uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) }, uPower: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime, uPower; uniform vec3 uA, uB;
      void main() {
        vec2 p = vUv - 0.5;
        float r = length(p) * 2.0;
        float a = atan(p.y, p.x);
        float rings = smoothstep(0.9, 1.0, sin(r * 42.0 - uTime * 2.0));
        float spokes = smoothstep(0.96, 1.0, sin(a * 24.0 + uTime * 0.4)) * smoothstep(0.25, 0.9, r);
        float pulse = (1.0 - smoothstep(0.0, 0.05, abs(fract(r - uTime * 0.25) - 0.5) - 0.02));
        vec3 base = vec3(0.012, 0.01, 0.022);
        vec3 col = base + uA * (rings * 0.5 + pulse * 0.9) * uPower + uB * spokes * 0.7 * uPower;
        col *= (1.0 - smoothstep(0.92, 1.0, r));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}
