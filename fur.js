/* ---------------------------------------------------------------------------
   Furry 3D cats.

   Each cat's coat is painted onto a canvas texture from the same pedigree
   codes the flat portraits use — colour letters, the white number, the tabby
   number, the eye number. Fur is done with shells: the head is drawn a dozen
   times, each copy pushed a little further out along its normals, with more of
   each copy dissolved away the further out it sits. Stack those and the eye
   reads it as fur.

   One WebGL canvas floats over the whole page. Every cat that is currently on
   screen gets drawn into its own scissored rectangle of that canvas, lined up
   with the slot it belongs to; anything scrolled off screen costs nothing.

   If WebGL is missing, or anything in here throws, the flat SVG portraits are
   left exactly as they were.
--------------------------------------------------------------------------- */
import * as THREE from "./vendor/three.module.min.js";

/* index.html hands over the pedigree data and the code-reading helpers */
const D = window.FUR;

const SMALL  = innerWidth < 760;
const SHELLS = SMALL ? 6 : 12;
const FUR    = 0.085;
const INK    = 0x332049;

/* ---------- paint a coat from the codes ---------- */
function coatTexture(node){
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const g = cv.getContext("2d");
  const rnd = D.rng(D.hashName(node.name) + 7);
  const meta = D.codeMeta(node.code);
  const solid = node.cols.filter(c => c !== "white");
  const base = D.C[solid[0]] || "#B7A6BC";
  const second = solid[1] ? D.C[solid[1]] : null;
  const white = meta.white || (node.cols.includes("white") ? "03" : null);
  const tabby = meta.tabby || (node.tabby ? "25" : null);

  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);

  /* tortoiseshell mottling, repeated across the seam so the wrap doesn't show */
  if (second) {
    g.fillStyle = second;
    for (let i = 0; i < 26; i++) {
      const x = rnd() * 256, y = 30 + rnd() * 210;
      const r1 = 10 + rnd() * 22, r2 = 8 + rnd() * 16, a = rnd() * 3.14;
      for (const dx of [-256, 0, 256]) {
        g.save(); g.translate(x + dx, y); g.rotate(a);
        g.beginPath(); g.ellipse(0, 0, r1, r2, 0, 0, 6.29); g.fill(); g.restore();
      }
    }
  }

  /* tabby markings, by type. v=1 is the top of the head, which is canvas y=0 */
  if (tabby) {
    g.strokeStyle = "rgba(51,32,73,.30)";
    g.fillStyle   = "rgba(51,32,73,.26)";
    g.lineWidth = 5;
    if (tabby === "25") {                     /* ticked: fine flecks */
      for (let i = 0; i < 260; i++) g.fillRect(rnd() * 256, rnd() * 170, 3, 7);
    } else if (tabby === "24") {              /* spotted */
      for (let i = 0; i < 44; i++) {
        const x = rnd() * 256, y = 14 + rnd() * 165;
        g.beginPath(); g.ellipse(x, y, 7, 5, rnd() * 3, 0, 6.29); g.fill();
      }
    } else {                                  /* mackerel / classic stripes */
      const step = tabby === "22" ? 46 : 26;
      for (let x = 8; x < 256; x += step) {
        g.beginPath(); g.moveTo(x, 4);
        g.bezierCurveTo(x + 12, 55, x - 12, 110, x + 6, 168);
        g.stroke();
      }
    }
  }

  /* white climbs up from the chin; the number says how far */
  if (white) {
    const climb = { "01": .80, "02": .58, "03": .36, "09": .17 }[white] || .3;
    const yTop = 256 * (1 - climb);
    g.fillStyle = "#FFFDF7";
    g.beginPath();
    g.moveTo(0, 256);
    g.lineTo(0, yTop + 16);
    for (let x = 0; x <= 256; x += 16) {
      const bib = (x > 74 && x < 182) ? -16 : 8;   /* the bib rides higher up front */
      g.lineTo(x, yTop + Math.sin(x * .11 + rnd() * 3) * 8 + bib);
    }
    g.lineTo(256, 256);
    g.closePath(); g.fill();
  }

  const tx = new THREE.CanvasTexture(cv);
  tx.wrapS = THREE.RepeatWrapping;
  tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}

/* ---------- shared renderer bits ---------- */
let renderer = null, noiseTex = null, headGeo = null, camera = null;
const scenes = [];
let panelSlot = null;

function noiseTexture(){
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d"), im = g.createImageData(128, 128);
  for (let i = 0; i < im.data.length; i += 4) {
    const v = Math.random() * 255;
    im.data[i] = im.data[i+1] = im.data[i+2] = v; im.data[i+3] = 255;
  }
  g.putImageData(im, 0, 0);
  const tx = new THREE.CanvasTexture(cv);
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  return tx;
}

function furMaterial(map, shell, len){
  return new THREE.ShaderMaterial({
    uniforms: { map:{value:map}, noiseTex:{value:noiseTex},
                shell:{value:shell}, furLen:{value:len === undefined ? FUR : len} },
    vertexShader: `
      uniform float shell; uniform float furLen;
      varying vec2 vUv; varying vec3 vN;
      void main(){
        vUv = uv; vN = normalMatrix * normal;
        vec3 p = position + normal * shell * furLen;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform sampler2D noiseTex; uniform float shell;
      varying vec2 vUv; varying vec3 vN;
      void main(){
        float n = texture2D(noiseTex, vUv * 8.0).r;
        if (n < shell * 1.05) discard;              /* thins out further from the skin */
        vec3 c = texture2D(map, vUv).rgb * mix(0.90, 1.22, shell);
        float l = 0.74 + 0.30 * max(dot(normalize(vN), normalize(vec3(0.35,0.6,0.85))), 0.0);
        gl_FragColor = vec4(c * l, 1.0);
      }`
  });
}

const lam = c => new THREE.MeshLambertMaterial({ color: c });

function buildCat(node){
  const meta = D.codeMeta(node.code);
  const solid = node.cols.filter(c => c !== "white");
  const base = new THREE.Color(D.C[solid[0]] || "#B7A6BC");
  const second = solid[1] ? new THREE.Color(D.C[solid[1]]) : null;
  const map = coatTexture(node);
  const g = new THREE.Group();

  for (let i = 0; i <= SHELLS; i++) {
    const m = new THREE.Mesh(headGeo, furMaterial(map, i / SHELLS));
    m.scale.set(1, .93, .97);
    g.add(m);
  }
  /* longhair gets a second, longer coat around the ruff */
  if (meta.longhair) {
    for (let i = 1; i <= (SMALL ? 3 : 5); i++) {
      const m = new THREE.Mesh(headGeo, furMaterial(map, i / (SMALL ? 3 : 5), .40));
      m.scale.set(1.05, .9, 1.0); m.position.y = -.14;
      g.add(m);
    }
  }

  const earGeo = new THREE.ConeGeometry(.34, .74, 4);
  [[-.56, base], [.56, second || base]].forEach(([x, col]) => {
    const e = new THREE.Mesh(earGeo, lam(col));
    e.position.set(x, .90, .04); e.rotation.z = x < 0 ? .34 : -.34;
    g.add(e);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(.17, .40, 4), lam(0xE9A7B4));
    inner.position.set(x * .96, .87, .20); inner.rotation.z = e.rotation.z;
    g.add(inner);
  });

  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(.33, 18, 12), lam(0xFFFDF7));
  muzzle.scale.set(1.3, .8, .68); muzzle.position.set(0, -.33, .80);
  g.add(muzzle);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(.085, .085, 3), lam(0xC96E7E));
  nose.rotation.x = Math.PI; nose.position.set(0, -.18, 1.03);
  g.add(nose);

  const eyeCode = meta.eyes;
  const cols = eyeCode === "63" ? [0x7FB2E5, 0xE9A72B]
             : eyeCode && D.EYECOL[eyeCode] ? [D.EYECOL[eyeCode], D.EYECOL[eyeCode]]
             : [0xE9A72B, 0xE9A72B];
  const eyes = [];
  [-.36, .36].forEach((x, i) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(.20, 16, 12), lam(cols[i]));
    e.position.set(x, .10, .80); g.add(e); eyes.push(e);
    const p = new THREE.Mesh(new THREE.SphereGeometry(.09, 10, 8), lam(INK));
    p.scale.set(.7, 1.3, .5); p.position.set(x, .10, .97); g.add(p);
  });

  return { group: g, eyes };
}

const px = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener("pointermove", e => { px.x = e.clientX; px.y = e.clientY; }, { passive: true });

function makeScene(node, scale){
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xC9BCEA, 2.1));
  const d = new THREE.DirectionalLight(0xffffff, 2.0);
  d.position.set(1, 2, 3); scene.add(d);
  const cat = buildCat(node);
  cat.group.scale.setScalar(scale || 1);
  scene.add(cat.group);
  return { scene, cat };
}

let enabled = true;
function adopt(el, node, scale){
  const { scene, cat } = makeScene(node, scale);
  const rec = { el, node, scene, cat, blinkAt: performance.now() + 1200 + Math.random() * 4200, blinkUntil: 0 };
  scenes.push(rec);
  return rec;
}

function disposeScene(rec){
  rec.scene.traverse(o => {
    if (o.geometry && o.geometry !== headGeo) o.geometry.dispose();
    if (o.material) {
      if (o.material.uniforms && o.material.uniforms.map) o.material.uniforms.map.value.dispose();
      o.material.dispose();
    }
  });
}

/* the detail panel swaps between cats, so it gets its own slot */
/* Flat portraits say more at a glance, so 3D is a switch rather than a
   one-way door. Off puts the SVG faces straight back. */
export function furSet(on){
  if (!renderer) return;
  enabled = on;
  renderer.domElement.style.display = on ? "" : "none";
  document.body.classList.toggle("furry", on);
  for (const s of scenes) {
    if (panelSlot && s === panelSlot.rec) continue;
    s.el.innerHTML = on ? "" : window.face(s.node);
  }
  try { localStorage.setItem("yoshi.fur", on ? "1" : "0"); } catch (e) {}
}

export function furPanel(node){
  const host = document.getElementById("catface");
  if (!host || !renderer || !enabled) return false;
  if (panelSlot) {
    scenes.splice(scenes.indexOf(panelSlot.rec), 1);
    disposeScene(panelSlot.rec);
  }
  host.innerHTML = "";
  const slot = document.createElement("div");
  slot.style.cssText = "width:100%;height:100%";
  host.appendChild(slot);
  panelSlot = { rec: adopt(slot, node, 1.05) };
  return true;
}

export function furReplace(){
  try {
    const probe = document.createElement("canvas");
    if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) return false;

    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !SMALL });
    renderer.setPixelRatio(Math.min(devicePixelRatio, SMALL ? 1.5 : 2));
    renderer.autoClear = false;
    renderer.domElement.id = "furgl";
    document.body.appendChild(renderer.domElement);

    noiseTex = noiseTexture();
    headGeo  = new THREE.SphereGeometry(1, SMALL ? 20 : 26, SMALL ? 14 : 18);
    camera   = new THREE.PerspectiveCamera(30, 1, .1, 20);
    camera.position.set(0, .12, 5.4);

    /* every card identifier */
    D.all.forEach(rec => {
      const svg = rec.el.querySelector("svg");
      if (!svg) return;
      const slot = document.createElement("div");
      slot.className = "fur-slot";
      svg.replaceWith(slot);
      adopt(slot, rec.node, 1);
    });

    /* and the big one in the header */
    const hero = document.getElementById("bigcat");
    if (hero) {
      const slot = document.createElement("div");
      slot.id = "bigcat"; slot.className = "bigcat fur-slot";
      hero.replaceWith(slot);
      adopt(slot, D.root, 1.05);
    }

    const reduced = matchMedia("(prefers-reduced-motion:reduce)").matches;
    let last = 0, sw = 0, sh = 0;

    (function loop(t){
      requestAnimationFrame(loop);
      if (t - last < 1000 / 30) return;           /* 30fps is plenty for fur */
      last = t;
      if (!enabled || document.body.classList.contains("locked")) return;

      const w = innerWidth, h = innerHeight;
      if (sw !== w || sh !== h) { renderer.setSize(w, h); sw = w; sh = h; }

      renderer.setScissorTest(false);
      renderer.clear(true, true, false);          /* wipe last frame's ghosts */
      renderer.setScissorTest(true);

      for (const s of scenes) {
        const r = s.el.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < 0 || r.top > h || r.right < 0 || r.left > w) continue;
        const y = h - r.bottom;
        renderer.setViewport(r.left, y, r.width, r.height);
        renderer.setScissor(r.left, y, r.width, r.height);

        if (!reduced) {
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const ry = THREE.MathUtils.clamp((px.x - cx) / w * 1.6, -.6, .6);
          const rx = THREE.MathUtils.clamp((px.y - cy) / h * 1.2, -.42, .5);
          s.cat.group.rotation.y += (ry - s.cat.group.rotation.y) * .14;
          s.cat.group.rotation.x += (rx - s.cat.group.rotation.x) * .14;
          if (t > s.blinkAt) { s.blinkUntil = t + 130; s.blinkAt = t + 2200 + Math.random() * 4500; }
          const target = t < s.blinkUntil ? .08 : 1;
          s.cat.eyes.forEach(e => { e.scale.y += (target - e.scale.y) * .45; });
        }
        renderer.render(s.scene, camera);
      }
      renderer.setScissorTest(false);
    })(0);

    document.body.classList.add("furry");
    let want = true;
    try { want = localStorage.getItem("yoshi.fur") !== "0"; } catch (e) {}
    if (!want) furSet(false);
    return true;
  } catch (e) {
    console.warn("fur disabled:", e);
    if (renderer && renderer.domElement) renderer.domElement.remove();
    return false;
  }
}
