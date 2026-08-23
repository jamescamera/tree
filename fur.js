/* Generated cat portraits.
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
const DIR = "./assets/cats/";
const HAVE = new Set(["yoshi","blue","blue-white-01","blue-white-02","blue-white-03",
 "blue-white-harlequin","blue-tabby","blue-tortie","lilac","lilac-white-03","cream",
 "cream-white-03","chocolate","chocolate-white-03","cinnamon","fawn","black",
 "black-white-03","white","black-smoke","blue-point","lilac-point","chocolate-point",
 "tabby","brown-tabby","tortie","blue-cream-tortie","lilac-cream-tortie",
 "chocolate-tortie","blue-cream-white-03","silver-shaded","golden-shaded",
 "grace-dominica-blh","mum-blue-white-03","dad-blue"]);

/* No red or cinnamon-tortie artwork exists yet, so those fall to their nearest
   relative rather than to a default. Noted rather than hidden. */
const NEAREST = { red: "cream", cinnamon: "cinnamon", fawn: "fawn", black: "black",
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
    if (base === "cinnamon") return "cinnamon";
    if (base === "blue") return white ? "blue-cream-white-03" : "blue-cream-tortie";
    return "tortie";
  }
  if (tabby) return base === "blue" ? "blue-tabby"
            : base === "chocolate" || base === "cinnamon" ? "brown-tabby" : "tabby";
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

let on = false, currentNode = null;

function paintHero(){
  const old = document.getElementById("bigcat");
  if (!old) return;
  let el;
  if (on) {
    el = imageFor(D.root, "bigcat generated-cat");
  } else if (window.face) {
    const holder = document.createElement("span");
    holder.innerHTML = window.face(D.root);
    el = holder.firstElementChild;
    el.classList.add("bigcat");
  }
  if (!el) return;
  el.id = "bigcat";
  old.replaceWith(el);
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
  if (currentNode) furPanel(currentNode);
}

/* Called once at load. Apply a stored preference straight away rather than
   waiting for the first click, which the previous version forgot to do. */
export function furReplace(){
  try { on = localStorage.getItem("yoshi.cats") === "1"; } catch (e) { on = false; }
  if (on) paintHero();
  return true;
}
