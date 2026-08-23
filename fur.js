/* ---------------------------------------------------------------------------
   Furry 3D cats — modular British Shorthair body.

   The coat is painted from the same pedigree/EMS codes as the flat portraits,
   but the geometry is a real sitting British Shorthair loaded from a small
   glTF 2.0 binary. The UVs deliberately run from belly (V=0) to spine/head
   (V=1), with a controlled chest lift, so white 01/02/03/09 remains a useful
   biological-looking threshold instead of becoming a random belt.

   Tiny cards still have the SVG fallback. The 3D version is for the hero,
   detail panel and optional larger moments.
--------------------------------------------------------------------------- */
import * as THREE from "./vendor/three.module.min.js";

const D = window.FUR;
const SMALL = innerWidth < 760;
const SHELLS = SMALL ? 4 : 8;
const FUR = 0.022;
const INK = 0x332049;
const MODEL_URL = "./assets/british_shorthair_base.glb";

let renderer=null, noiseTex=null, coatGeo=null, camera=null, gl=null;
let modelPromise=null, mounted=false, enabled=true, dirty=true;
const scenes=[];
let panelSlot=null;

/* ---------- coat painting ---------- */
function coatTexture(node){
  const cv=document.createElement("canvas");
  cv.width=cv.height=512;
  const g=cv.getContext("2d");
  const rnd=D.rng(D.hashName(node.name)+7);
  const meta=D.codeMeta(node.code);
  const solid=node.cols.filter(c=>c!=="white");
  const base=D.C[solid[0]]||"#B7A6BC";
  const second=solid[1]?D.C[solid[1]]:null;
  const white=meta.white||(node.cols.includes("white")?"03":null);
  const tabby=meta.tabby||(node.tabby?"25":null);

  g.fillStyle=base;
  g.fillRect(0,0,512,512);

  /* Asymmetric tortie mottling. Repeat across the seam so the cylindrical
     U=0/1 join remains invisible. */
  if(second){
    g.fillStyle=second;
    for(let i=0;i<52;i++){
      const x=rnd()*512, y=20+rnd()*470;
      const rx=12+rnd()*30, ry=9+rnd()*24, a=rnd()*Math.PI;
      for(const dx of [-512,0,512]){
        g.save();g.translate(x+dx,y);g.rotate(a);
        g.beginPath();g.ellipse(0,0,rx,ry,0,0,Math.PI*2);g.fill();g.restore();
      }
    }
  }

  /* Tabby markings are kept deterministic per cat, but now follow the actual
     body UVs rather than a head-shaped sphere atlas. */
  if(tabby){
    g.strokeStyle="rgba(51,32,73,.28)";
    g.fillStyle="rgba(51,32,73,.24)";
    if(tabby==="25"){
      for(let i=0;i<520;i++)g.fillRect(rnd()*512,rnd()*390,3,8);
    }else if(tabby==="24"){
      for(let i=0;i<90;i++){g.beginPath();g.ellipse(rnd()*512,18+rnd()*390,8,6,rnd()*3,0,Math.PI*2);g.fill();}
    }else{
      const step=tabby==="22"?54:32;
      g.lineWidth=6;
      for(let x=10;x<512;x+=step){
        g.beginPath();g.moveTo(x,0);
        g.bezierCurveTo(x+14,120,x-14,260,x+8,410);g.stroke();
      }
    }
  }

  /* White threshold: the asset's V=0 is belly/feet and V=1 is spine/head.
     Because the model gives the chest a slight UV lift, the same threshold
     rises naturally over the bib while staying lower over the back. */
  if(white){
    const climb={"01":.80,"02":.58,"03":.36,"09":.17}[white]||.3;
    const yTop=512*(1-climb);
    g.fillStyle="#FFFDF7";
    g.beginPath();
    g.moveTo(0,512);g.lineTo(0,yTop);
    for(let x=0;x<=512;x+=16){
      const chest=(x>165&&x<350)?-13:5;
      g.lineTo(x,yTop+Math.sin(x*.045+rnd()*2)*8+chest);
    }
    g.lineTo(512,512);g.closePath();g.fill();
  }

  const tx=new THREE.CanvasTexture(cv);
  tx.colorSpace=THREE.SRGBColorSpace;
  tx.wrapS=tx.wrapT=THREE.RepeatWrapping;
  tx.flipY=true;
  return tx;
}

function noiseTexture(){
  const cv=document.createElement("canvas");cv.width=cv.height=128;
  const g=cv.getContext("2d"),im=g.createImageData(128,128);
  for(let i=0;i<im.data.length;i+=4){const v=Math.random()*255;im.data[i]=im.data[i+1]=im.data[i+2]=v;im.data[i+3]=255;}
  g.putImageData(im,0,0);
  const tx=new THREE.CanvasTexture(cv);tx.wrapS=tx.wrapT=THREE.RepeatWrapping;return tx;
}

function furMaterial(map,shell,len){
  return new THREE.ShaderMaterial({
    uniforms:{map:{value:map},noiseTex:{value:noiseTex},shell:{value:shell},furLen:{value:len===undefined?FUR:len}},
    vertexShader:`
      uniform float shell; uniform float furLen;
      varying vec2 vUv; varying vec3 vN;
      void main(){
        vUv=uv; vN=normalMatrix*normal;
        vec3 p=position+normal*shell*furLen;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
      }`,
    fragmentShader:`
      uniform sampler2D map; uniform sampler2D noiseTex; uniform float shell;
      varying vec2 vUv; varying vec3 vN;
      void main(){
        float n=texture2D(noiseTex,vUv*15.0).r;
        if(n<shell*1.05)discard;
        vec3 c=texture2D(map,vUv).rgb*mix(.92,1.18,shell);
        float l=.76+.28*max(dot(normalize(vN),normalize(vec3(.35,.6,.85))),0.0);
        gl_FragColor=vec4(c*l,1.0);
      }`
  });
}

const lam=c=>new THREE.MeshLambertMaterial({color:c});

/* ---------- tiny GLB reader ----------
   The asset deliberately keeps the first primitive as the complete coat/face
   assembly, so we don't need to ship the much larger examples/GLTFLoader. */
async function loadBshGeometry(url){
  const buf=await fetch(url,{cache:"force-cache"}).then(r=>{if(!r.ok)throw new Error(`GLB ${r.status}`);return r.arrayBuffer();});
  const dv=new DataView(buf);
  if(dv.getUint32(0,true)!==0x46546c67)throw new Error("Not a GLB");
  let off=12,json=null,bin=null;
  while(off<buf.byteLength){
    const len=dv.getUint32(off,true),type=dv.getUint32(off+4,true),start=off+8,data=buf.slice(start,start+len);
    if(type===0x4E4F534A)json=JSON.parse(new TextDecoder().decode(data).replace(/\0+$/g,"").trim());
    else if(type===0x004E4942)bin=data;
    off=start+len;
  }
  if(!json||!bin)throw new Error("Incomplete GLB");
  const mesh=json.meshes[0].primitives[0],geo=new THREE.BufferGeometry();
  const read=accessorIndex=>{
    const a=json.accessors[accessorIndex],bv=json.bufferViews[a.bufferView];
    const comps={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
    const size={5126:4,5125:4,5123:2,5121:1}[a.componentType];
    const stride=bv.byteStride||comps*size,start=(bv.byteOffset||0)+(a.byteOffset||0),out=new Float32Array(a.count*comps),dv2=new DataView(bin);
    for(let i=0;i<a.count;i++)for(let j=0;j<comps;j++){
      const p=start+i*stride+j*size;
      out[i*comps+j]=a.componentType===5126?dv2.getFloat32(p,true):a.componentType===5125?dv2.getUint32(p,true):a.componentType===5123?dv2.getUint16(p,true):dv2.getUint8(p);
    }
    return {a,out};
  };
  const pos=read(mesh.attributes.POSITION),uv=read(mesh.attributes.TEXCOORD_0),norm=read(mesh.attributes.NORMAL),idx=read(mesh.indices);
  geo.setAttribute("position",new THREE.BufferAttribute(pos.out,3));
  geo.setAttribute("uv",new THREE.BufferAttribute(uv.out,2));
  geo.setAttribute("normal",new THREE.BufferAttribute(norm.out,3));
  const IndexArray=idx.a.componentType===5125?Uint32Array:Uint16Array;
  geo.setIndex(new THREE.BufferAttribute(new IndexArray(idx.out.map(v=>v)),1));
  geo.computeBoundingSphere();
  return geo;
}

function buildCat(node){
  const meta=D.codeMeta(node.code),solid=node.cols.filter(c=>c!=="white");
  const base=new THREE.Color(D.C[solid[0]]||"#B7A6BC");
  const map=coatTexture(node),g=new THREE.Group();
  const len=meta.longhair?0.040:FUR;
  for(let i=0;i<=SHELLS;i++)g.add(new THREE.Mesh(coatGeo,furMaterial(map,i/SHELLS,len)));

  /* Characterful BSH face pieces: low-set rounded ears, broad jowl pads and
     a short triangular nose. They are deliberately separate from the coat
     shell so the face stays crisp while the body gets procedural fur. */
  const earGeo=new THREE.SphereGeometry(1,12,8);
  [[-.235,.862,.02,.13,.16,.075],[.235,.862,.02,.13,.16,.075]].forEach(([x,y,z,sx,sy,sz])=>{
    const e=new THREE.Mesh(earGeo,lam(base));e.scale.set(sx,sy,sz);e.position.set(x,y,z);g.add(e);
    const inner=new THREE.Mesh(new THREE.SphereGeometry(1,10,7),lam(0xE9A7B4));
    inner.scale.set(sx*.52,sy*.55,sz*.55);inner.position.set(x,y-.005,z+.055);g.add(inner);
  });
  const padL=new THREE.Mesh(new THREE.SphereGeometry(1,14,10),lam(0xFFFDF7));
  padL.scale.set(.13,.085,.075);padL.position.set(-.105,.676,.296);g.add(padL);
  const padR=padL.clone();padR.position.x=.105;g.add(padR);
  const chin=new THREE.Mesh(new THREE.SphereGeometry(1,14,10),lam(0xFFFDF7));
  chin.scale.set(.15,.065,.07);chin.position.set(0,.635,.28);g.add(chin);
  const nose=new THREE.Mesh(new THREE.ConeGeometry(.028,.038,3),lam(0xC96E7E));
  nose.rotation.x=Math.PI;nose.position.set(0,.709,.335);g.add(nose);

  const eyeCode=meta.eyes;
  const eyeCols=eyeCode==="63"?[0x7FB2E5,0xE9A72B]:eyeCode&&D.EYECOL[eyeCode]?[D.EYECOL[eyeCode],D.EYECOL[eyeCode]]:[0xE9A72B,0xE9A72B];
  const eyes=[];
  [-.112,.112].forEach((x,i)=>{
    const e=new THREE.Mesh(new THREE.SphereGeometry(.048,14,10),lam(eyeCols[i]));
    e.position.set(x,.786,.276);g.add(e);eyes.push(e);
    const p=new THREE.Mesh(new THREE.SphereGeometry(.020,10,8),lam(INK));
    p.scale.set(.7,1.35,.5);p.position.set(x,.786,.318);g.add(p);
  });
  return {group:g,eyes};
}

const px={x:innerWidth/2,y:innerHeight/2,moved:0};
addEventListener("pointermove",e=>{px.x=e.clientX;px.y=e.clientY;px.moved++;},{passive:true});

function makeScene(node,scale){
  const scene=new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff,0xC9BCEA,2.1));
  const d=new THREE.DirectionalLight(0xffffff,2.0);d.position.set(1,2,3);scene.add(d);
  const cat=buildCat(node);cat.group.scale.setScalar(scale||1);scene.add(cat.group);
  return {scene,cat};
}

function mount(target,node,cssSize,scale){
  const canvas=document.createElement("canvas"),dpr=Math.min(devicePixelRatio||1,2);
  canvas.width=canvas.height=Math.round(cssSize*dpr);
  canvas.style.cssText=`width:${cssSize}px;height:${cssSize}px;flex:none;display:block`;
  canvas.className="fur-slot";target.replaceWith(canvas);
  const {scene,cat}=makeScene(node,scale);
  const rec={canvas,ctx:canvas.getContext("2d"),node,scene,cat,blinkAt:performance.now()+1500+Math.random()*5000,blinkUntil:0,ease:1};
  scenes.push(rec);return rec;
}

function disposeScene(rec){
  rec.scene.traverse(o=>{if(o.material){if(o.material.uniforms?.map)o.material.uniforms.map.value.dispose();o.material.dispose();}});
}

function startLoop(){
  const reduced=matchMedia("(prefers-reduced-motion:reduce)").matches;let lastPx=-1,last=0;
  (function loop(t){
    requestAnimationFrame(loop);
    if(!enabled||!mounted||document.body.classList.contains("locked"))return;
    if(t-last<1000/24)return;last=t;
    const pointerMoved=px.moved!==lastPx;lastPx=px.moved;const wasDirty=dirty;dirty=false;
    for(const s of scenes){
      const blinking=t<s.blinkUntil||t>s.blinkAt,easing=s.ease>.0015;
      if(!wasDirty&&!pointerMoved&&!blinking&&!easing)continue;
      const r=s.canvas.getBoundingClientRect();if(!r.width||r.bottom<-40||r.top>innerHeight+40)continue;
      if(!reduced){
        if(pointerMoved||s.ty===undefined){
          const cx=r.left+r.width/2,cy=r.top+r.height/2;
          s.ty=THREE.MathUtils.clamp((px.x-cx)/innerWidth*1.6,-.6,.6);
          s.tx=THREE.MathUtils.clamp((px.y-cy)/innerHeight*1.2,-.42,.5);
        }
        const dy=s.ty-s.cat.group.rotation.y,dx=s.tx-s.cat.group.rotation.x;
        s.cat.group.rotation.y+=dy*.18;s.cat.group.rotation.x+=dx*.18;s.ease=Math.abs(dy)+Math.abs(dx);
        if(t>s.blinkAt){s.blinkUntil=t+130;s.blinkAt=t+2600+Math.random()*5200;}
        const target=t<s.blinkUntil?.08:1;s.cat.eyes.forEach(e=>e.scale.y+=(target-e.scale.y)*.5);
      }
      renderer.render(s.scene,camera);
      const g2=s.ctx;g2.clearRect(0,0,s.canvas.width,s.canvas.height);g2.drawImage(gl,0,0,s.canvas.width,s.canvas.height);
    }
  })(0);
}

async function mountAll(){
  if(mounted)return true;
  try{
    coatGeo=await(modelPromise||(modelPromise=loadBshGeometry(MODEL_URL)));
    renderer=new THREE.WebGLRenderer({alpha:true,antialias:!SMALL});
    renderer.setPixelRatio(1);renderer.setSize(SMALL?192:288,SMALL?192:288,false);gl=renderer.domElement;
    noiseTex=noiseTexture();
    camera=new THREE.PerspectiveCamera(30,1,.05,10);camera.position.set(0,.50,2.45);camera.lookAt(0,.50,0.02);
    D.all.forEach(rec=>{const svg=rec.el.querySelector("svg");if(svg)mount(svg,rec.node,48,1);});
    const hero=document.getElementById("bigcat");
    if(hero){const c=mount(hero,D.root,innerWidth<620?118:160,1);c.canvas.id="bigcat";c.canvas.classList.add("bigcat");}
    mounted=true;startLoop();dirty=true;return true;
  }catch(e){console.warn("fur unavailable:",e);return false;}
}

export function furSet(on){
  enabled=on;dirty=true;document.body.classList.toggle("furry",on);
  try{localStorage.setItem("yoshi.fur",on?"1":"0");}catch(e){}
  if(on)mountAll().then(ok=>{if(!ok)enabled=false;});
  else for(const s of scenes){if(panelSlot&&s===panelSlot.rec)continue;s.canvas.style.display="none";if(!s.svg){s.svg=document.createElement("span");s.svg.className="fur-flat";s.svg.style.cssText=`display:block;flex:none;width:${s.canvas.style.width};height:${s.canvas.style.height}`;s.svg.innerHTML=window.face(s.node);s.canvas.after(s.svg);}else s.svg.style.display="";}
}

export function furPanel(node){
  const host=document.getElementById("catface");if(!host||!renderer||!enabled)return false;
  if(panelSlot){const i=scenes.indexOf(panelSlot.rec);if(i>=0)scenes.splice(i,1);disposeScene(panelSlot.rec);}
  host.innerHTML="<span></span>";
  const size=Math.max(56,Math.min(220,Math.round(host.clientWidth)||66));
  panelSlot={rec:mount(host.firstChild,node,size,1)};dirty=true;return true;
}

export function furReplace(){
  const probe=document.createElement("canvas");
  if(!(probe.getContext("webgl2")||probe.getContext("webgl")))return false;
  let want=false;try{want=localStorage.getItem("yoshi.fur")==="1";}catch(e){}
  if(want)furSet(true);return true;
}
