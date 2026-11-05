// Material and particle library. Built on three.js PBR shading with small shader
// patches (fresnel rim, subsurface-like glow, organic noise, water films, flow),
// chosen to be cheap enough for CPU (SwiftShader) rendering at 3840x2160.
import * as THREE from 'three';

export const NOISE_GLSL = /* glsl */`
vec3 _m289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 _m289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 _perm(vec4 x){return _m289(((x*34.0)+10.0)*x);}
vec4 _tis(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy; i=_m289(i);
  vec4 p=_perm(_perm(_perm(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx; vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_); vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw); vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=_tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3))); p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){float a=0.5,s=0.0;for(int i=0;i<4;i++){s+=a*snoise(p);p*=2.03;a*=0.5;}return s;}
`;

const WPOS_VERT = /* glsl */`
  vec4 _wp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    _wp = instanceMatrix * _wp;
  #endif
  _wp = modelMatrix * _wp;
  vWPos = _wp.xyz;
  vOPos = position;
`;

/**
 * Organic PBR material: standard shading plus a fresnel rim, a soft
 * subsurface-like inner glow and procedural albedo/roughness variation.
 */
export function organicMaterial(o = {}) {
  const m = new (o.physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({
    color: o.color ?? 0xcccccc, roughness: o.roughness ?? 0.55, metalness: 0,
    transparent: !!o.transparent, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide,
    depthWrite: o.depthWrite ?? !o.transparent, map: o.map ?? null, normalMap: o.normalMap ?? null,
    envMapIntensity: o.envMapIntensity ?? 1, vertexColors: !!o.vertexColors, flatShading: !!o.flat,
  });
  if (o.physical) { m.clearcoat = o.clearcoat ?? 0; m.clearcoatRoughness = o.clearcoatRoughness ?? 0.2; }
  const u = m.userData.u = {
    rimColor: { value: new THREE.Color(o.rimColor ?? 0xffffff) },
    rimPower: { value: o.rimPower ?? 3.0 },
    rimStrength: { value: o.rimStrength ?? 0.0 },
    sssColor: { value: new THREE.Color(o.sssColor ?? 0x000000) },
    sssStrength: { value: o.sssStrength ?? 0.0 },
    nScale: { value: o.noiseScale ?? 1.0 },
    nAmp: { value: o.noiseAmp ?? 0.0 },
    nColor: { value: new THREE.Color(o.noiseColor ?? 0x000000) },
    alphaFres: { value: o.alphaFresnel ?? 0.0 },
    time: { value: 0 },
    backColor: { value: new THREE.Color(o.backColor ?? (o.color ?? 0xcccccc)) },
    backMix: { value: o.backColor !== undefined ? 1 : 0 },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vOPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + WPOS_VERT);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vOPos;
        uniform vec3 rimColor; uniform float rimPower; uniform float rimStrength;
        uniform vec3 sssColor; uniform float sssStrength; uniform float nScale; uniform float nAmp;
        uniform vec3 nColor; uniform float alphaFres; uniform float time; uniform vec3 backColor; uniform float backMix;
        ${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float _n = nAmp > 0.0 ? fbm(vOPos * nScale) : 0.0;
        diffuseColor.rgb = mix(diffuseColor.rgb, nColor, clamp(_n * nAmp, 0.0, 1.0));
        diffuseColor.rgb *= 1.0 + 0.25 * nAmp * _n;
        if (backMix > 0.5 && !gl_FrontFacing) diffuseColor.rgb = backColor;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 _vd = normalize(vViewPosition);
        float _fres = pow(1.0 - clamp(abs(dot(normal, _vd)), 0.0, 1.0), rimPower);
        totalEmissiveRadiance += rimColor * _fres * rimStrength;
        totalEmissiveRadiance += sssColor * sssStrength * (0.35 + 0.65 * pow(1.0 - clamp(abs(dot(normal, _vd)), 0.0, 1.0), 1.2));
        diffuseColor.a = mix(diffuseColor.a, 1.0, _fres * alphaFres);`);
  };
  m.customProgramCacheKey = () => 'organic' + (o.physical ? 'P' : 'S') + (o.backColor !== undefined ? 'b' : '');
  return m;
}

/**
 * Liquid water: glassy, fresnel-weighted transparency, environment
 * reflections, a luminous blue body and optional animated flow streaks.
 */
export function waterMaterial(o = {}) {
  const m = new THREE.MeshStandardMaterial({
    color: o.color ?? 0x2f8fe0, roughness: o.roughness ?? 0.06, metalness: 0,
    transparent: true, opacity: o.opacity ?? 0.38, depthWrite: o.depthWrite ?? false,
    side: o.side ?? THREE.FrontSide, envMapIntensity: o.envMapIntensity ?? 1.6,
  });
  const u = m.userData.u = {
    glow: { value: new THREE.Color(o.glow ?? 0x2b8cff) },
    glowStrength: { value: o.glowStrength ?? 0.35 },
    fresAlpha: { value: o.fresAlpha ?? 0.55 },
    flowDir: { value: new THREE.Vector3(...(o.flowDir ?? [0, 1, 0])) },
    flowSpeed: { value: o.flowSpeed ?? 0.0 },
    flowScale: { value: o.flowScale ?? 1.0 },
    flowStrength: { value: o.flowStrength ?? 0.0 },
    time: { value: 0 },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vOPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + WPOS_VERT);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vOPos;
        uniform vec3 glow; uniform float glowStrength; uniform float fresAlpha;
        uniform vec3 flowDir; uniform float flowSpeed; uniform float flowScale; uniform float flowStrength; uniform float time;
        ${NOISE_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 _vd = normalize(vViewPosition);
        float _ndv = clamp(abs(dot(normal, _vd)), 0.0, 1.0);
        float _fres = pow(1.0 - _ndv, 2.5);
        float _flow = 0.0;
        if (flowStrength > 0.0) {
          vec3 q = vOPos * flowScale - flowDir * time * flowSpeed;
          _flow = smoothstep(0.15, 0.85, 0.5 + 0.5 * snoise(q * vec3(1.0, 0.35, 1.0)));
        }
        totalEmissiveRadiance += glow * glowStrength * (0.55 + 0.45 * _ndv + flowStrength * _flow);
        diffuseColor.a = clamp(mix(diffuseColor.a, 1.0, _fres * fresAlpha) + 0.25 * flowStrength * _flow, 0.0, 1.0);`);
  };
  m.customProgramCacheKey = () => 'water';
  return m;
}

/** Additive, view-dependent glow — for flows, highlighted pathways and halos. */
export function glowMaterial(o = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(o.color ?? 0x48b8ff) },
      intensity: { value: o.intensity ?? 1.5 },
      power: { value: o.power ?? 1.5 },
      opacity: { value: o.opacity ?? 1 },
      time: { value: 0 },
      dashes: { value: o.dashes ?? 0 },
      speed: { value: o.speed ?? 0 },
      progress: { value: o.progress ?? 1 },
      head: { value: o.head ?? 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        #ifdef USE_INSTANCING
          mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #endif
        vN = normalize(normalMatrix * normal); vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 color; uniform float intensity; uniform float power; uniform float opacity;
      uniform float time; uniform float dashes; uniform float speed; uniform float progress; uniform float head;
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        float core = pow(ndv, power);
        float a = core;
        if (dashes > 0.0) a *= 0.35 + 0.65 * smoothstep(0.35, 0.5, abs(fract(vUv.x * dashes - time * speed) - 0.5));
        if (vUv.x > progress) discard;
        float tip = head > 0.0 ? smoothstep(progress - head, progress, vUv.x) : 0.0;
        gl_FragColor = vec4(color * intensity * (a + 1.6 * tip * core), opacity * clamp(a + tip, 0.0, 1.0));
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: o.side ?? THREE.FrontSide,
    depthTest: o.depthTest ?? true,
  });
}

/**
 * Camera-facing particle sprites (instanced quads). shape: 'soft' (gaussian
 * glow) or 'sphere' (lit sphere impostor with specular highlight).
 */
export class Sprites {
  constructor(count, o = {}) {
    this.count = count;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.offset = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1);
    for (const a of [this.offset, this.size, this.color, this.alpha]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iOffset', this.offset); g.setAttribute('iSize', this.size);
    g.setAttribute('iColor', this.color); g.setAttribute('iAlpha', this.alpha);
    g.instanceCount = count;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: o.scale ?? 1 }, sphere: { value: o.shape === 'sphere' ? 1 : 0 },
        opacity: { value: o.opacity ?? 1 }, intensity: { value: o.intensity ?? 1 }, fogColor: { value: new THREE.Color(o.fogColor ?? 0x000000) },
        fogDensity: { value: o.fogDensity ?? 0 } },
      vertexShader: /* glsl */`
        attribute vec3 iOffset; attribute float iSize; attribute vec3 iColor; attribute float iAlpha;
        uniform float scale; varying vec2 vQ; varying vec3 vCol; varying float vA; varying float vDepth;
        void main(){
          vQ = position.xy; vCol = iColor; vA = iAlpha;
          vec4 mv = modelViewMatrix * vec4(iOffset, 1.0);
          mv.xy += position.xy * iSize * scale;
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform float sphere; uniform float opacity; uniform float intensity; uniform vec3 fogColor; uniform float fogDensity;
        varying vec2 vQ; varying vec3 vCol; varying float vA; varying float vDepth;
        void main(){
          float r2 = dot(vQ, vQ);
          if (r2 > 1.0) discard;
          vec3 c; float a;
          if (sphere > 0.5) {
            vec3 n = vec3(vQ, sqrt(1.0 - r2));
            vec3 L = normalize(vec3(-0.45, 0.6, 0.66));
            float d = max(dot(n, L), 0.0);
            float s = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 40.0);
            float rim = pow(1.0 - n.z, 2.0);
            c = vCol * (0.28 + 0.85 * d) + vec3(0.9) * s * 0.85 + vCol * rim * 0.35;
            a = smoothstep(1.0, 0.9, r2);
          } else {
            float g = exp(-r2 * 3.2);
            c = vCol * g; a = g;
          }
          float f = 1.0 - exp(-fogDensity * vDepth);
          c = mix(c * intensity, fogColor, f);
          gl_FragColor = vec4(c, a * vA * opacity);
        }`,
      transparent: true, depthWrite: !!o.depthWrite, depthTest: o.depthTest ?? true,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.renderOrder ?? 10;
  }
  set(i, p, size, col, a = 1) {
    this.offset.setXYZ(i, p.x, p.y, p.z); this.size.setX(i, size);
    if (col) this.color.setXYZ(i, col.r, col.g, col.b);
    this.alpha.setX(i, a);
  }
  /** Sort far-to-near for correct alpha blending (normal blending only). */
  sortBy(camera) {
    const n = this.count, o = this.offset.array, d = new Float32Array(n), idx = Array.from({ length: n }, (_, i) => i);
    const cp = camera.position;
    for (let i = 0; i < n; i++) { const dx = o[i * 3] - cp.x, dy = o[i * 3 + 1] - cp.y, dz = o[i * 3 + 2] - cp.z; d[i] = dx * dx + dy * dy + dz * dz; }
    idx.sort((a, b) => d[b] - d[a]);
    for (const attr of [this.offset, this.size, this.color, this.alpha]) {
      const src = attr.array.slice(), k = attr.itemSize;
      for (let j = 0; j < n; j++) for (let c = 0; c < k; c++) attr.array[j * k + c] = src[idx[j] * k + c];
    }
  }
  commit() { for (const a of [this.offset, this.size, this.color, this.alpha]) a.needsUpdate = true; }
}

/** Dashed segments (e.g. hydrogen bonds): instanced thin cylinders with a dash shader. */
export class DashedBonds {
  constructor(max, o = {}) {
    this.max = max;
    const g = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    g.translate(0, 0.5, 0);
    const ig = new THREE.InstancedBufferGeometry().copy(g);
    this.len = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    ig.setAttribute('iLen', this.len); ig.setAttribute('iAlpha', this.alpha);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(o.color ?? 0xbfe9ff) }, dash: { value: o.dash ?? 0.55 }, intensity: { value: o.intensity ?? 1.6 } },
      vertexShader: /* glsl */`
        attribute float iLen; attribute float iAlpha; varying float vL; varying float vA; varying vec3 vN; varying vec3 vV;
        void main(){ vL = uv.y * iLen; vA = iAlpha;
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal); vV = -mv.xyz;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`
        uniform vec3 color; uniform float dash; uniform float intensity; varying float vL; varying float vA; varying vec3 vN; varying vec3 vV;
        void main(){ float f = fract(vL / dash); if (f > 0.55 || vA < 0.01) discard;
          float ndv = abs(dot(normalize(vN), normalize(vV)));
          gl_FragColor = vec4(color * intensity * (0.45 + 0.55 * ndv), vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(ig, this.mat, max);
    this.mesh.frustumCulled = false;
    this.radius = o.radius ?? 0.06;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._d = new THREE.Vector3();
    this.n = 0;
  }
  begin() { this.n = 0; }
  add(a, b, alpha) {
    if (this.n >= this.max) return;
    const d = this._d.subVectors(b, a); const L = d.length();
    this._q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.multiplyScalar(1 / L));
    this._s.set(this.radius, L, this.radius);
    this._m.compose(a, this._q, this._s);
    this.mesh.setMatrixAt(this.n, this._m); this.len.setX(this.n, L); this.alpha.setX(this.n, alpha);
    this.n++;
  }
  end() {
    for (let i = this.n; i < this.max; i++) { this.alpha.setX(i, 0); this._m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this._m); }
    this.mesh.instanceMatrix.needsUpdate = true; this.len.needsUpdate = true; this.alpha.needsUpdate = true;
  }
}

/** Update the `time` uniform of every patched material in a scene. */
export function tickMaterials(scene, t) {
  scene.traverse(o => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (m.userData?.u?.time) m.userData.u.time.value = t;
      if (m.uniforms?.time) m.uniforms.time.value = t;
    }
  });
}
