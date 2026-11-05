// Post-processing: per-shot HDR render with depth of field, shot transitions,
// bloom, filmic tone mapping + grade (vignette, grain, lens fringe) and FXAA.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function hdrTarget(w, h, depth = false) {
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
  if (depth) { rt.depthTexture = new THREE.DepthTexture(w, h); rt.depthTexture.type = THREE.FloatType; }
  return rt;
}

export class Post {
  constructor(renderer, W, H) {
    this.r = renderer; this.W = W; this.H = H; this.u = H / 1080;
    this.scene = [hdrTarget(W, H, true), hdrTarget(W, H, true)];
    this.shotOut = [hdrTarget(W, H), hdrTarget(W, H)];
    this.half = [hdrTarget(W >> 1, H >> 1), hdrTarget(W >> 1, H >> 1)];
    this.comp = hdrTarget(W, H);
    this.ldr = new THREE.WebGLRenderTarget(W, H, { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
    this.q = new FullScreenQuad();

    this.cocMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, tDepth: { value: null }, near: { value: 0.1 }, far: { value: 100 },
        focus: { value: 10 }, aperture: { value: 0 }, maxCoc: { value: 22 }, u: { value: this.u } },
      vertexShader: VERT,
      fragmentShader: /* glsl */`#include <packing>
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform float near; uniform float far;
        uniform float focus; uniform float aperture; uniform float maxCoc; uniform float u; varying vec2 vUv;
        void main(){
          float z = texture2D(tDepth, vUv).x;
          float d = -perspectiveDepthToViewZ(z, near, far);
          float coc = clamp(aperture * abs(1.0 - focus / max(d, 1e-4)), 0.0, maxCoc) * u * 0.5; // half-res px
          gl_FragColor = vec4(texture2D(tColor, vUv).rgb, coc);
        }`,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tHalf: { value: null }, texel: { value: new THREE.Vector2(2 / W, 2 / H) } },
      vertexShader: VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tHalf; uniform vec2 texel; varying vec2 vUv;
        const int N = 40; const float GA = 2.39996323;
        void main(){
          vec4 c0 = texture2D(tHalf, vUv);
          float R = c0.a;
          vec3 acc = c0.rgb; float wsum = 1.0; float cocAcc = c0.a;
          if (R < 0.35) { gl_FragColor = c0; return; }
          for (int i = 1; i < N; i++){
            float fi = float(i);
            float r = sqrt(fi / float(N)) * R;           // golden-angle disc of our own CoC
            float th = fi * GA;
            vec2 o = vec2(cos(th), sin(th)) * r;
            vec4 s = texture2D(tHalf, vUv + o * texel);
            float w = smoothstep(r - 1.0, r + 0.5, s.a); // sharp neighbours do not bleed into blur
            acc += s.rgb * w; wsum += w; cocAcc += s.a * w;
          }
          gl_FragColor = vec4(acc / wsum, cocAcc / wsum);
        }`,
    });
    this.dofMixMat = new THREE.ShaderMaterial({
      uniforms: { tSharp: { value: null }, tBlur: { value: null }, tDepth: { value: null }, near: { value: 0.1 }, far: { value: 100 },
        focus: { value: 10 }, aperture: { value: 0 }, maxCoc: { value: 22 }, u: { value: this.u } },
      vertexShader: VERT,
      fragmentShader: /* glsl */`#include <packing>
        uniform sampler2D tSharp; uniform sampler2D tBlur; uniform sampler2D tDepth; uniform float near; uniform float far;
        uniform float focus; uniform float aperture; uniform float maxCoc; uniform float u; varying vec2 vUv;
        void main(){
          float z = texture2D(tDepth, vUv).x;
          float d = -perspectiveDepthToViewZ(z, near, far);
          float coc = clamp(aperture * abs(1.0 - focus / max(d, 1e-4)), 0.0, maxCoc) * u * 0.5;
          vec4 b = texture2D(tBlur, vUv);
          float k = smoothstep(0.6, 2.2, max(coc, b.a * 0.85));
          gl_FragColor = vec4(mix(texture2D(tSharp, vUv).rgb, b.rgb, k), 1.0);
        }`,
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: { tA: { value: null }, tB: { value: null }, mixAmt: { value: 0 }, zoomA: { value: 0 }, zoomB: { value: 0 },
        dip: { value: 0 }, blurA: { value: 0 }, blurB: { value: 0 }, texel: { value: new THREE.Vector2(1 / W, 1 / H) } },
      vertexShader: VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tA; uniform sampler2D tB; uniform float mixAmt; uniform float zoomA; uniform float zoomB;
        uniform float dip; uniform float blurA; uniform float blurB; uniform vec2 texel; varying vec2 vUv;
        vec3 radial(sampler2D t, vec2 uv, float zoom, float blur){
          vec2 c = vec2(0.5); vec2 p = c + (uv - c) / (1.0 + zoom);
          if (blur <= 0.001) return texture2D(t, p).rgb;
          vec3 acc = vec3(0.0);
          for (int i = 0; i < 12; i++){ float k = float(i) / 11.0; acc += texture2D(t, c + (p - c) * (1.0 - blur * k)).rgb; }
          return acc / 12.0;
        }
        void main(){
          vec3 a = radial(tA, vUv, zoomA, blurA);
          vec3 col = a;
          if (mixAmt > 0.0001) { vec3 b = radial(tB, vUv, zoomB, blurB); col = mix(a, b, mixAmt); }
          col *= 1.0 - dip;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.gradeMat = new THREE.ShaderMaterial({
      uniforms: {
        tHDR: { value: null }, exposure: { value: 1 }, time: { value: 0 }, res: { value: new THREE.Vector2(W, H) },
        vignette: { value: 0.35 }, grain: { value: 0.012 }, ca: { value: 0.0025 }, saturation: { value: 1.0 }, contrast: { value: 1.04 },
        lift: { value: new THREE.Vector3(0, 0, 0) }, gain: { value: new THREE.Vector3(1, 1, 1) }, fade: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tHDR; uniform float exposure; uniform float time; uniform vec2 res; uniform float vignette;
        uniform float grain; uniform float ca; uniform float saturation; uniform float contrast; uniform vec3 lift; uniform vec3 gain; uniform float fade;
        varying vec2 vUv;
        // AgX (Troy Sobotka), as in three.js r170
        vec3 agxCurve(vec3 x){ vec3 x2=x*x; vec3 x4=x2*x2;
          return 15.5*x4*x2 - 40.14*x4*x + 31.96*x4 - 6.868*x2*x + 0.4298*x2 + 0.1191*x - 0.00232; }
        vec3 AgX(vec3 color){
          const mat3 inM = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859);
          const mat3 outM = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
          const mat3 toRec2020 = mat3(0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0113, 0.8956);
          const mat3 fromRec2020 = mat3(1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187);
          color = toRec2020 * color; color = inM * color; color = max(color, 1e-10);
          color = log2(color); color = (color + 12.47393) / 16.5; color = clamp(color, 0.0, 1.0);
          color = agxCurve(color); color = outM * color; color = pow(max(vec3(0.0), color), vec3(2.2));
          color = fromRec2020 * color; return clamp(color, 0.0, 1.0);
        }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
        void main(){
          vec2 d = vUv - 0.5; float r2 = dot(d, d);
          vec3 col = vec3(texture2D(tHDR, vUv - d * ca * r2 * 4.0).r, texture2D(tHDR, vUv).g, texture2D(tHDR, vUv + d * ca * r2 * 4.0).b);
          col = AgX(col * exposure);
          col = toSRGB(col);
          col = gain * (col + lift * (1.0 - col));
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(l), col, saturation);
          col = (col - 0.5) * contrast + 0.5;
          float v = smoothstep(1.05, 0.25, length(d * vec2(1.0, 0.82)) * 1.35);
          col *= mix(1.0, v, vignette);
          float g = hash(vUv * res + fract(time * 13.37) * 100.0) - 0.5;
          col += g * grain * (0.6 + 0.4 * (1.0 - l));
          gl_FragColor = vec4(clamp(col, 0.0, 1.0) * fade, 1.0);
        }`,
    });
    this.fxaa = new THREE.ShaderMaterial(FXAAShader);
    this.fxaa.uniforms.resolution.value.set(1 / W, 1 / H);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.35, 0.55, 1.0);
  }

  /** Render one shot into HDR buffer `slot` (0|1) with optional DOF. Returns its texture. */
  renderShot(slot, scene, camera, o = {}) {
    const r = this.r, sRT = this.scene[slot];
    r.setRenderTarget(sRT); r.setClearColor(scene.background?.isColor ? scene.background : new THREE.Color(0), 1);
    r.clear(); r.render(scene, camera);
    if (!o.aperture) return sRT.texture;
    for (const m of [this.cocMat, this.dofMixMat]) {
      m.uniforms.near.value = camera.near; m.uniforms.far.value = camera.far;
      m.uniforms.focus.value = o.focus; m.uniforms.aperture.value = o.aperture; m.uniforms.maxCoc.value = o.maxCoc ?? 22;
    }
    this.cocMat.uniforms.tColor.value = sRT.texture; this.cocMat.uniforms.tDepth.value = sRT.depthTexture;
    this.q.material = this.cocMat; r.setRenderTarget(this.half[0]); this.q.render(r);
    this.blurMat.uniforms.tHalf.value = this.half[0].texture;
    this.q.material = this.blurMat; r.setRenderTarget(this.half[1]); this.q.render(r);
    Object.assign(this.dofMixMat.uniforms, {});
    this.dofMixMat.uniforms.tSharp.value = sRT.texture; this.dofMixMat.uniforms.tBlur.value = this.half[1].texture;
    this.dofMixMat.uniforms.tDepth.value = sRT.depthTexture;
    this.q.material = this.dofMixMat; r.setRenderTarget(this.shotOut[slot]); this.q.render(r);
    return this.shotOut[slot].texture;
  }

  /** Composite one or two shot textures (transition) into the HDR comp buffer. */
  composite(texA, texB, t = {}) {
    const u = this.compMat.uniforms;
    u.tA.value = texA; u.tB.value = texB ?? texA; u.mixAmt.value = texB ? (t.mix ?? 0) : 0;
    u.zoomA.value = t.zoomA ?? 0; u.zoomB.value = t.zoomB ?? 0; u.dip.value = t.dip ?? 0;
    u.blurA.value = t.blurA ?? 0; u.blurB.value = t.blurB ?? 0;
    this.q.material = this.compMat; this.r.setRenderTarget(this.comp); this.q.render(this.r);
  }

  /** Bloom, grade and anti-alias the comp buffer to the canvas. */
  finish(g = {}) {
    const r = this.r;
    if ((g.bloom ?? 0.35) > 0) {
      this.bloom.strength = g.bloom ?? 0.35; this.bloom.radius = g.bloomRadius ?? 0.55; this.bloom.threshold = g.bloomThreshold ?? 1.0;
      this.bloom.render(r, null, this.comp, 0, false);
    }
    const u = this.gradeMat.uniforms;
    u.tHDR.value = this.comp.texture;
    for (const k of ['exposure', 'vignette', 'grain', 'ca', 'saturation', 'contrast', 'fade', 'time']) if (g[k] !== undefined) u[k].value = g[k];
    u.lift.value.set(...(g.lift ?? [0, 0, 0])); u.gain.value.set(...(g.gain ?? [1, 1, 1]));
    this.q.material = this.gradeMat; r.setRenderTarget(this.ldr); this.q.render(r);
    this.fxaa.uniforms.tDiffuse.value = this.ldr.texture;
    this.q.material = this.fxaa; r.setRenderTarget(null); this.q.render(r);
  }
}
