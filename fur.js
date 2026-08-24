/* Generated cat portraits.
 *
 * The artwork arrived as full-body cutouts whose mattes had eaten into the
 * cats — amputated paws, notched flanks, in a few cases most of the body. The
 * damage is all below the chest, so the assets are stored cropped to a bust,
 * which is both intact and a better portrait. See docs/cat-artwork.md.
 *
 * The 45 small pedigree cards keep their SVG portraits — they stay legible at
 * 48px and they encode the markings, which a photo can't. The hero and the
 * detail card use pre-rendered British Shorthair artwork instead.
 *
 * Which picture a cat gets is decided from node.cols and the EMS code, the same
 * two things the SVG portraits read. An earlier version pattern-matched the raw
 * code string, which meant every cat whose colour is written as a word rather
 * than a letter — the UK side, and the whole German branch — silently came out
 * blue. cols is curated per cat and always right, so it drives this instead.
 */
const D = window.FUR;
const DEFAULT_ON = true;   /* the portraits lead the site; the drawn heads are the alternative */
const DIR = "./assets/cats/";
const HAVE = new Set(["yoshi","blue","blue-white-01","blue-white-02","blue-white-03",
 "blue-white-harlequin","blue-tabby","blue-tortie","lilac","lilac-white-03","cream",
 "cream-white-03","chocolate","chocolate-white-03","cinnamon","fawn","black",
 "black-white-03","white","black-smoke","blue-point","lilac-point","chocolate-point",
 "brown-tabby","tortie","blue-cream-tortie","lilac-cream-tortie","grace-dominica-blh",
 "chocolate-tortie","blue-cream-white-03","silver-shaded","golden-shaded",
 "mum-blue-white-03","dad-blue","red-white-03"]);

/* Tabbies that are neither blue nor chocolate use the brown tabby, there being
   no generic tabby artwork. Grace Dominica is no longer a substitution: the
   longhair artwork is now fawn and white, which is what BLH p 03 says she is. */
const NEAREST = { red: "red", cinnamon: "cinnamon", fawn: "fawn", black: "black",
                  blue: "blue", lilac: "lilac", cream: "cream", chocolate: "chocolate" };

function pick(node){
  if (!node) return "blue";
  if (node === D.root) return "yoshi";

  const meta = D.codeMeta(node.code) || {};
  const cols = node.cols || [];
  const solid = cols.filter(c => c !== "white");
  const white = meta.white || (cols.includes("white") ? "03" : null);
  const tabby = meta.tabby || (node.tabby ? "25" : null);

  if (meta.longhair) return "grace-dominica-blh";
  if (!solid.length) return "white";

  const base = NEAREST[solid[0]] || "blue";

  if (solid.length > 1) {                       /* tortoiseshell */
    if (base === "lilac") return "lilac-cream-tortie";
    if (base === "chocolate") return "chocolate-tortie";
    if (base === "cinnamon") return "cinnamon"; // no usable cinnamon-tortie source yet
    if (base === "blue") return white ? "blue-cream-white-03" : "blue-cream-tortie";
    return "tortie";
  }
  if (tabby) return base === "blue" ? "blue-tabby" : "brown-tabby";
  if (white) {
    for (const k of [`${base}-white-${white}`, `${base}-white-03`])
      if (HAVE.has(k)) return k;
  }
  return HAVE.has(base) ? base : "blue";
}

function imageFor(node, className){
  const key = pick(node);
  if (!HAVE.has(key)) return null;
  const img = document.createElement("img");
  img.className = className;
  img.src = DIR + key + ".webp";
  img.alt = node && node.name ? node.name : "British Shorthair";
  img.decoding = "async";
  img.draggable = false;
  return img;
}

let on = DEFAULT_ON, currentNode = null;

function drawn(node, cls){
  if (!window.face) return null;
  const holder = document.createElement("span");
  holder.innerHTML = window.face(node);
  const el = holder.firstElementChild;
  if (el && cls) el.classList.add(cls);
  return el;
}

function paintHero(){
  const old = document.getElementById("bigcat");
  if (!old) return;
  const el = on ? imageFor(D.root, "bigcat generated-cat") : drawn(D.root, "bigcat");
  if (!el) return;
  el.id = "bigcat";
  old.replaceWith(el);
}

/* Every pedigree card carries a portrait frame. Fill all of them in one pass
   rather than per click, so the wall of faces is what you land on. */
function paintCards(){
  (D.all || []).forEach(({ node, el }) => {
    const slot = el && el.querySelector(".cface");
    if (!slot) return;
    const next = on ? imageFor(node, "generated-cat") : drawn(node);
    if (next) slot.replaceChildren(next);
  });
}

function paintGate(){
  const host = document.getElementById("gatecat");
  if (!host) return;
  const el = on ? imageFor(D.root, "generated-cat") : drawn(D.root);
  if (el) host.replaceChildren(el);
}

export function furPanel(node){
  currentNode = node || currentNode || D.root;
  const host = document.getElementById("catface");
  if (!host) return false;
  if (on) {
    const img = imageFor(currentNode, "generated-cat-detail");
    if (img) { host.replaceChildren(img); return true; }
  }
  if (window.face) host.innerHTML = window.face(currentNode);
  return false;
}

export function furSet(value){
  on = !!value;
  try { localStorage.setItem("yoshi.cats", on ? "1" : "0"); } catch (e) {}
  paintHero();
  paintCards();
  paintGate();
  if (currentNode) furPanel(currentNode);
}

export function furOn(){ return on; }

/* Called once at load. The portraits are the design now, so they are on unless
   this browser has explicitly turned them off — an absent key means on, which a
   plain === "1" test would have got backwards. */
export function furReplace(){
  let stored = null;
  try { stored = localStorage.getItem("yoshi.cats"); } catch (e) {}
  on = stored === null ? DEFAULT_ON : stored === "1";
  paintHero();
  paintCards();
  paintGate();
  return true;
}
