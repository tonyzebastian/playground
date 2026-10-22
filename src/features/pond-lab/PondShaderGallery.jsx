"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, Drop, Cursor, Sparkle, Waves } from "@phosphor-icons/react";
import styles from "./PondShaderGallery.module.css";

const vertexShader = `attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }`;

export const waterFragmentShader = `precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec4 u_ripples[12]; // xy: pixel position, z: time, w: strength

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return -1.0 + 2.0 * mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y);
}
float seaOctave(vec2 uv, float choppy) {
  uv += noise(uv);
  vec2 wave = 1.0 - abs(sin(uv));
  wave = mix(wave, abs(cos(uv)), wave);
  return pow(1.0 - pow(wave.x * wave.y, .65), choppy);
}
const mat2 octaveMatrix = mat2(1.6, 1.2, -1.2, 1.6);
float heightAt(vec2 uv) {
  float frequency = .16, amplitude = .6, choppy = 4.0, height = 0.0;
  float waveTime = u_time * .8;
  for (int i = 0; i < 5; i++) {
    float octave = seaOctave((uv + waveTime) * frequency, choppy) + seaOctave((uv - waveTime) * frequency, choppy);
    height += octave * amplitude; uv *= octaveMatrix; frequency *= 1.9; amplitude *= .22; choppy = mix(choppy, 1.0, .2);
  }
  return height;
}
vec3 normalAt(vec2 uv, float epsilon) {
  float h = heightAt(uv);
  return normalize(vec3(h - heightAt(uv + vec2(epsilon, 0.)), epsilon * 8.0, h - heightAt(uv + vec2(0., epsilon))));
}
float rippleAt(vec2 position, vec2 center, float dropTime) {
  float age = u_time - dropTime;
  if (age < 0.0 || age > 4.0) return 0.0;
  float epsilon = .04, h = heightAt(position);
  vec2 gradient = vec2(heightAt(position + vec2(epsilon, 0.)) - h, heightAt(position + vec2(0., epsilon)) - h) / epsilon;
  float distortion = noise(position * 3.0 + u_time * .5) * .15;
  vec2 delta = position - center + gradient * 1.2 + vec2(distortion, -distortion);
  float distanceToCenter = length(delta);
  float wavefront = age * 4.5 * (1.0 + h * .3);
  float envelope = exp(-pow(distanceToCenter - wavefront, 2.0) / 1.5);
  return .45 * envelope * exp(-age * 1.4) * cos(distanceToCenter * 5.0 - u_time * 6.0);
}
vec3 waterColor(vec3 normal, float height) {
  vec3 deep = vec3(.02, .18, .32), water = vec3(.25, .65, .60), sky = vec3(.50, .82, .88);
  vec3 light = normalize(vec3(.4, .7, .3)), eye = vec3(0., 1., 0.);
  float fresnel = clamp(pow(1.0 - max(dot(normal, eye), 0.0), 3.0) * .65, 0., 1.);
  float diffuse = pow(dot(normal, light) * .4 + .6, 80.0);
  vec3 colour = mix(deep + diffuse * water * .12, sky, fresnel) + water * (height - .6) * .18;
  float specular = pow(max(dot(reflect(-eye, normal), light), 0.0), 60.0);
  return colour + vec3(specular * ((60.0 + 8.0) / (3.14159 * 8.0)) * .15);
}
void main() {
  vec2 pixel = gl_FragCoord.xy; pixel.y = u_resolution.y - pixel.y;
  vec2 uv = (pixel / min(u_resolution.x, u_resolution.y)) * 30.0;
  float height = heightAt(uv);
  for (int i = 0; i < 12; i++) {
    vec2 center = (u_ripples[i].xy / min(u_resolution.x, u_resolution.y)) * 30.0;
    height += rippleAt(uv, center, u_ripples[i].z) * u_ripples[i].w;
  }
  gl_FragColor = vec4(clamp(pow(waterColor(normalAt(uv, .01), height), vec3(.75)), 0., 1.), 1.0);
}`;

const shaderEntries = [
  { id: "water", eyebrow: "01 · WebGL", title: "Seascape water", description: "Five rotated seascape octaves form the water height field. Its normals drive the deep-water colour, sky Fresnel, diffuse light and specular highlight.", uses: "Use as the base canvas for any pond or liquid surface." },
  { id: "ripple", eyebrow: "02 · WebGL", title: "Slope-aware ripples", description: "Twelve time-stamped rings expand, decay and layer into the water shader. Click a preview to seed another ring.", uses: "Use for wakes, raindrops, food drops, or touch feedback." },
  { id: "texture", eyebrow: "03 · 2D canvas", title: "Paper & edge texture", description: "A generated grain pass adds warmth, subtle variance and a soft organic pond boundary without an extra animation loop.", uses: "Render once on load or resize, then leave it alone." },
  { id: "reeds", eyebrow: "04 · 2D canvas", title: "Reed canopy", description: "Procedural stems and cattails sway independently above the water. It overflows the frame so the edge feels planted, not clipped.", uses: "Keep this separate from the shader for inexpensive detail." },
];

function drawTexture(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < image.data.length; i += 4) {
    const light = Math.random() > .38;
    const n = Math.random() * 42;
    image.data[i] = light ? 242 + n * .25 : 24 + n;
    image.data[i + 1] = light ? 236 + n * .2 : 30 + n;
    image.data[i + 2] = light ? 220 + n * .16 : 38 + n;
    image.data[i + 3] = 8 + Math.random() * 29;
  }
  ctx.putImageData(image, 0, 0);
  const gradient = ctx.createRadialGradient(width / 2, height / 2, height * .18, width / 2, height / 2, height * .8);
  gradient.addColorStop(0, "rgba(255, 228, 152, 0)");
  gradient.addColorStop(1, "rgba(220, 215, 210, .22)");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
}

function drawReeds(ctx, width, height, time) {
  ctx.clearRect(0, 0, width, height);
  const stem = (x, base, length, side, index) => {
    const sway = Math.sin(time * .0012 + index * 1.77) * (3 + length * .018);
    const topX = x + sway + side * 8;
    const topY = base - length;
    ctx.beginPath(); ctx.moveTo(x, base); ctx.quadraticCurveTo(x + side * 9, base - length * .55, topX, topY);
    ctx.strokeStyle = index % 3 ? "rgba(112, 152, 100, .63)" : "rgba(135, 172, 118, .62)";
    ctx.lineWidth = .65 + index % 2 * .45; ctx.stroke();
    if (index % 3 === 0) { ctx.fillStyle = "rgba(105, 77, 57, .55)"; ctx.beginPath(); ctx.ellipse(topX, topY + 5, 1.8, 6.4, .2, 0, Math.PI * 2); ctx.fill(); }
  };
  for (let i = 0; i < 32; i++) stem(i * width / 31, height + 5, 20 + (i * 29) % 67, i % 2 ? 1 : -1, i);
  for (let i = 0; i < 12; i++) { stem(-2, height - i * 25, 24 + i * 5, 1, i + 33); stem(width + 2, height - i * 25, 25 + i * 5, -1, i + 47); }
  for (let i = 0; i < 9; i++) stem(i * width / 8, 0, 18 + (i * 19) % 46, i % 2 ? 1 : -1, i + 60);
}

function Duck({ className, mirrored = false }) {
  return <svg className={`${styles.duck} ${className}`} viewBox="0 0 48 48" aria-hidden="true" style={{ transform: mirrored ? "scaleX(-1)" : undefined }}><ellipse cx="24" cy="26" rx="8" ry="9" fill="#e8e2d8"/><ellipse cx="23" cy="23" rx="3" ry="3.5" fill="white" opacity=".45"/><path d="M17 23 Q13 27 17 32 Q20 28 17 23M31 23 Q35 27 31 32 Q28 28 31 23" fill="#e8e2d8"/><circle cx="24" cy="16" r="6.5" fill="#f2eee7"/><path d="M24 10 Q28 8 30 12" fill="none" stroke="#d4ccc0" strokeWidth="1" opacity=".5"/><path d="M24 20 L20 22 L24 24" fill="#e7ae45"/><circle cx="22.3" cy="15.5" r=".8" fill="#4e4942"/></svg>;
}

export function PondCanvas({ layer = "all" }) {
  const waterRef = useRef(null); const textureRef = useRef(null); const reedsRef = useRef(null);
  const ripples = useRef([]);

  useEffect(() => {
    const canvas = waterRef.current; if (!canvas) return undefined;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false }); if (!gl) return undefined;
    const compile = (type, code) => { const shader = gl.createShader(type); gl.shaderSource(shader, code); gl.compileShader(shader); return shader; };
    const program = gl.createProgram(); gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexShader)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, waterFragmentShader)); gl.linkProgram(program); gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "aPosition"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const resolution = gl.getUniformLocation(program, "u_resolution"), timeLocation = gl.getUniformLocation(program, "u_time"), rippleLocations = Array.from({ length: 12 }, (_, index) => gl.getUniformLocation(program, `u_ripples[${index}]`));
    let frame;
    const resize = () => { const rect = canvas.getBoundingClientRect(); const scale = Math.min(window.devicePixelRatio || 1, 2); canvas.width = Math.max(1, Math.round(rect.width * scale)); canvas.height = Math.max(1, Math.round(rect.height * scale)); gl.viewport(0, 0, canvas.width, canvas.height); };
    const render = now => { const time = now / 1000; gl.uniform2f(resolution, canvas.width, canvas.height); gl.uniform1f(timeLocation, time); if (layer === "ripple" && ripples.current.length === 0) { ripples.current = [{ x: canvas.width * .32, y: canvas.height * .45, at: time - .3, strength: 1 }, { x: canvas.width * .68, y: canvas.height * .62, at: time - .85, strength: .75 }]; } const active = layer === "water" ? [] : ripples.current.filter(ripple => time - ripple.at < 4).slice(-12); ripples.current = active; rippleLocations.forEach((location, index) => { const ripple = active[index]; gl.uniform4f(location, ripple?.x || 0, ripple?.y || 0, ripple?.at ?? -10, ripple?.strength || 0); }); gl.drawArrays(gl.TRIANGLES, 0, 3); frame = requestAnimationFrame(render); };
    resize(); const observer = new ResizeObserver(resize); observer.observe(canvas); frame = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [layer]);

  useEffect(() => { const canvas = textureRef.current; if (!canvas) return; const resize = () => { const rect = canvas.getBoundingClientRect(); const scale = Math.min(window.devicePixelRatio || 1, 2); canvas.width = Math.max(1, Math.round(rect.width * scale)); canvas.height = Math.max(1, Math.round(rect.height * scale)); drawTexture(canvas); }; resize(); const observer = new ResizeObserver(resize); observer.observe(canvas); return () => observer.disconnect(); }, []);
  useEffect(() => {
    const canvas = reedsRef.current; if (!canvas) return undefined;
    const context = canvas.getContext("2d"); if (!context) return undefined;
    const resize = () => { const rect = canvas.getBoundingClientRect(); const scale = Math.min(window.devicePixelRatio || 1, 2); canvas.width = Math.max(1, Math.round(rect.width * scale)); canvas.height = Math.max(1, Math.round(rect.height * scale)); };
    let frame;
    const render = (now) => { drawReeds(context, canvas.width, canvas.height, now); frame = requestAnimationFrame(render); };
    resize(); const observer = new ResizeObserver(resize); observer.observe(canvas); frame = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);
  const addRipple = event => { const rect = event.currentTarget.getBoundingClientRect(); const canvas = waterRef.current; if (!canvas) return; ripples.current.push({ x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height, at: performance.now() / 1000, strength: 1 }); };
  return <div className={styles.pond} onPointerDown={addRipple} role="presentation">
    {(layer === "all" || layer === "water" || layer === "ripple") && <canvas ref={waterRef} className={styles.water} />}
    {(layer === "all" || layer === "texture") && <canvas ref={textureRef} className={styles.texture} />}
    {(layer === "all" || layer === "reeds") && <canvas ref={reedsRef} className={styles.reeds} />}
    {layer === "all" && <><Duck className={styles.duckOne} /><Duck className={styles.duckTwo} mirrored /></>}
  </div>;
}

function CopyButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(waterFragmentShader);
      else {
        const fallback = document.createElement("textarea");
        fallback.value = waterFragmentShader; document.body.appendChild(fallback); fallback.select(); document.execCommand("copy"); fallback.remove();
      }
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { setCopied(false); }
  };
  return <button className={styles.copy} onClick={copy}>{copied ? <Check weight="bold" size={15} /> : <Copy weight="bold" size={15} />}{copied ? "Copied" : "Copy water shader"}</button>;
}

export default function PondShaderGallery() {
  return <main className={styles.page}>
    <a href="/" className={styles.back}><ArrowLeft weight="bold" size={16} /> Back to playground</a>
    <header className={styles.intro}><p className={styles.kicker}>PRIVATE REFERENCE · POND STUDY 01</p><h1>Layered pond<br /><em>rendering kit.</em></h1><p>This is a reusable study of the Bao To pond: procedural water and live ripples in WebGL, with two inexpensive canvas layers that give it an illustrated edge.</p></header>
    <section className={styles.hero}><PondCanvas /><div className={styles.heroLabel}><Waves weight="bold" size={16} /> Click anywhere to make a ripple</div></section>
    <section className={styles.indexHeader}><div><p className={styles.kicker}>LAYER INDEX</p><h2>Each piece stands on its own.</h2></div><CopyButton /></section>
    <section className={styles.grid}>{shaderEntries.map((entry) => <article className={styles.card} key={entry.id}><div className={styles.preview}><PondCanvas layer={entry.id} /><div className={styles.previewTag}>{entry.id === "water" ? <Drop weight="bold" size={14} /> : entry.id === "ripple" ? <Cursor weight="bold" size={14} /> : <Sparkle weight="bold" size={14} />}{entry.id === "ripple" ? "Tap to test" : "Live preview"}</div></div><div className={styles.cardBody}><p className={styles.number}>{entry.eyebrow}</p><h3>{entry.title}</h3><p>{entry.description}</p><div className={styles.use}><strong>Reuse:</strong> {entry.uses}</div></div></article>)}</section>
    <section className={styles.notes}><p className={styles.kicker}>IMPLEMENTATION NOTES</p><p><strong>Stack order:</strong> WebGL water → paper texture → reeds → SVG creatures. The texture is deliberately drawn only at setup and resize; only the water and reeds own animation frames.</p><p><strong>Portable contract:</strong> the fragment shader expects <code>u_resolution</code>, <code>u_time</code>, and a 12-item <code>u_ripples</code> vec4 array. Each ripple is {"{ x, y, startTime, strength }"} in canvas-pixel coordinates.</p></section>
  </main>;
}
