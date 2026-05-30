import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';

const SUPPORTED_EXTS=['.stl','.obj','.ply','.glb','.gltf','.3mf'];
const DEFAULT_WARN_BYTES=50*1024*1024;
const DEFAULT_MAX_BYTES=250*1024*1024;
const TOOL_BUTTONS=[
  {id:'orbit',label:'Orbit',icon:'rotate-ccw'},
  {id:'pan',label:'Pan',icon:'move'},
  {id:'zoom-in',label:'Zoom in',icon:'zoom-in'},
  {id:'zoom-out',label:'Zoom out',icon:'zoom-out'},
  {id:'fit',label:'Fit model',icon:'maximize'},
  {id:'reset',label:'Reset view',icon:'refresh-cw'},
  {id:'grid',label:'Grid',icon:'grid-3x3'},
  {id:'axes',label:'Axes',icon:'axis-3d'},
  {id:'wireframe',label:'Wireframe',icon:'cuboid'},
  {id:'material',label:'Material mode',icon:'box'},
  {id:'rotate',label:'Auto rotate',icon:'rotate-cw'},
  {id:'screenshot',label:'Screenshot',icon:'camera'},
];

let state=null;
const customTools=[];

function $(id){return document.getElementById(id);}
function esc(value){
  const div=document.createElement('div');
  div.textContent=String(value??'');
  return div.innerHTML;
}
function fileExt(path){
  const value=String(path||'');
  const i=value.lastIndexOf('.');
  return i>=0?value.slice(i).toLowerCase():'';
}
function fileName(path){
  return String(path||'').split('/').pop()||String(path||'model');
}
function dirName(path){
  const parts=String(path||'').split('/');
  parts.pop();
  return parts.join('/');
}
function normalizeResourcePath(basePath, resource){
  const raw=String(resource||'').split('#')[0].split('?')[0];
  if(!raw) return '';
  if(/^(?:data|blob):/i.test(raw)) return raw;
  if(/^(?:https?:)?\/\//i.test(raw)) throw new Error('External model resources are blocked');
  if(raw.startsWith('/')) throw new Error('Absolute model resources are blocked');
  const base=dirName(basePath).split('/').filter(Boolean);
  const parts=raw.split('/').filter(Boolean);
  for(const part of parts){
    if(part==='.') continue;
    if(part==='..') base.pop();
    else base.push(part);
  }
  return base.join('/');
}
function rawUrl(sessionId,path){
  return `api/file/raw?session_id=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}&inline=1`;
}
function storageTabsKey(sessionId){
  return `hermes-3d-tabs:${sessionId}`;
}
function storageViewKey(sessionId,path){
  return `hermes-3d-view:${sessionId}:${path}`;
}
function loadTabs(sessionId){
  try{
    const raw=localStorage.getItem(storageTabsKey(sessionId));
    const parsed=raw?JSON.parse(raw):[];
    return Array.isArray(parsed)?parsed.filter(item=>item&&item.path):[];
  }catch(_){return [];}
}
function saveTabs(){
  if(!state||!state.sessionId) return;
  try{localStorage.setItem(storageTabsKey(state.sessionId),JSON.stringify(state.tabs.slice(0,16)));}catch(_){}
}
function limits(){
  const cfg=window.__HERMES_CONFIG__||{};
  return {
    warnBytes:Number(cfg.max3dWarnBytes)||DEFAULT_WARN_BYTES,
    maxBytes:Number(cfg.max3dBytes)||DEFAULT_MAX_BYTES,
  };
}
function setStatusText(text,kind=''){
  const el=$('preview3dStatus');
  if(!el) return;
  el.textContent=text||'';
  el.dataset.kind=kind||'';
}
function iconHtml(name,label){
  if(typeof window.li==='function'){
    const out=window.li(name,14);
    if(out) return out;
  }
  return `<span aria-hidden="true">${esc(String(label||name||'?').slice(0,1))}</span>`;
}
function toolButtonHtml(tool){
  return `<button type="button" class="preview-3d-tool" data-3d-tool="${esc(tool.id)}" title="${esc(tool.label||tool.id)}" aria-label="${esc(tool.label||tool.id)}" aria-pressed="false">${iconHtml(tool.icon,tool.label)}</button>`;
}
function renderToolbar(){
  const toolbar=$('preview3dToolbar');
  if(!toolbar||toolbar.dataset.rendered==='1') return;
  toolbar.innerHTML=[
    TOOL_BUTTONS.slice(0,4).map(toolButtonHtml).join(''),
    '<span class="preview-3d-toolbar-sep" aria-hidden="true"></span>',
    TOOL_BUTTONS.slice(4,6).map(toolButtonHtml).join(''),
    '<span class="preview-3d-toolbar-sep" aria-hidden="true"></span>',
    TOOL_BUTTONS.slice(6).map(toolButtonHtml).join(''),
    '<span class="preview-3d-toolbar-sep preview-3d-custom-sep" aria-hidden="true"></span>',
    '<span class="preview-3d-custom-tools" id="preview3dCustomTools"></span>',
  ].join('');
  toolbar.dataset.rendered='1';
}
function ensureState(){
  const wrap=$('preview3dWrap');
  const viewport=$('preview3dViewport');
  const canvasHost=$('preview3dCanvasHost');
  if(!wrap||!viewport||!canvasHost) throw new Error('3D preview container is missing');
  if(state&&state.wrap===wrap) return state;

  disposeState();
  const probe=document.createElement('canvas');
  if(!window.WebGLRenderingContext||(!probe.getContext('webgl2')&&!probe.getContext('webgl'))){
    throw new Error('WebGL is not available in this browser');
  }
  const scene=new THREE.Scene();
  scene.background=new THREE.Color(0x0f1117);
  const camera=new THREE.PerspectiveCamera(45,1,0.01,100000);
  camera.position.set(3,2,4);
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,alpha:false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.shadowMap.enabled=false;
  canvasHost.textContent='';
  canvasHost.appendChild(renderer.domElement);

  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  controls.dampingFactor=0.08;
  controls.screenSpacePanning=true;
  controls.addEventListener('end',saveCameraState);

  const hemi=new THREE.HemisphereLight(0xffffff,0x283040,1.8);
  scene.add(hemi);
  const key=new THREE.DirectionalLight(0xffffff,2.4);
  key.position.set(4,8,5);
  scene.add(key);
  const fill=new THREE.DirectionalLight(0xb7d7ff,0.9);
  fill.position.set(-5,3,-4);
  scene.add(fill);
  const grid=new THREE.GridHelper(10,20,0x4b5563,0x2a303a);
  grid.name='hermes-grid';
  scene.add(grid);
  const axes=new THREE.AxesHelper(2);
  axes.name='hermes-axes';
  scene.add(axes);

  state={
    wrap,viewport,canvasHost,scene,camera,renderer,controls,grid,axes,
    object:null,tabs:[],sessionId:'',currentPath:'',basePath:'',
    wireframe:false,materialMode:'material',autoRotate:false,navigationMode:'orbit',
    resizeObserver:null,animationId:0,disposed:false,
  };
  state.resizeObserver=new ResizeObserver(resize);
  state.resizeObserver.observe(viewport);
  renderToolbar();
  bindToolbar();
  animate();
  resize();
  return state;
}
function bindToolbar(){
  const toolbar=$('preview3dToolbar');
  if(toolbar&&toolbar.dataset.bound!=='1'){
    toolbar.dataset.bound='1';
    toolbar.addEventListener('click',event=>{
      const btn=event.target.closest('[data-3d-tool]');
      if(!btn) return;
      runTool(btn.dataset['3dTool']);
    });
  }
  const tabs=$('preview3dTabs');
  if(tabs&&tabs.dataset.bound!=='1'){
    tabs.dataset.bound='1';
    tabs.addEventListener('click',event=>{
      const tab=event.target.closest('[data-3d-tab-path]');
      const close=event.target.closest('[data-3d-tab-close]');
      if(close){
        event.stopPropagation();
        closeTab(close.dataset['3dTabClose']);
        return;
      }
      if(tab) openTab(tab.dataset['3dTabPath']);
    });
  }
}
function disposeState(){
  if(!state) return;
  state.disposed=true;
  if(state.animationId) cancelAnimationFrame(state.animationId);
  if(state.resizeObserver) state.resizeObserver.disconnect();
  if(state.controls) state.controls.dispose();
  disposeObject(state.object);
  if(state.renderer){
    state.renderer.dispose();
    if(state.renderer.domElement&&state.renderer.domElement.parentNode){
      state.renderer.domElement.parentNode.removeChild(state.renderer.domElement);
    }
  }
  state=null;
}
function disposeObject(root){
  if(!root) return;
  root.traverse(obj=>{
    if(obj.geometry) obj.geometry.dispose();
    const mats=Array.isArray(obj.material)?obj.material:[obj.material];
    mats.filter(Boolean).forEach(mat=>{
      for(const key of Object.keys(mat)){
        const value=mat[key];
        if(value&&value.isTexture) value.dispose();
      }
      mat.dispose();
    });
  });
}
function resize(){
  if(!state||state.disposed) return;
  const rect=state.viewport.getBoundingClientRect();
  const width=Math.max(1,Math.floor(rect.width));
  const height=Math.max(1,Math.floor(rect.height));
  state.camera.aspect=width/height;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(width,height,false);
}
function animate(){
  if(!state||state.disposed) return;
  state.animationId=requestAnimationFrame(animate);
  state.controls.autoRotate=!!state.autoRotate;
  state.controls.update();
  state.renderer.render(state.scene,state.camera);
}
function renderTabs(){
  const root=$('preview3dTabs');
  if(!root||!state) return;
  root.innerHTML=state.tabs.map(tab=>{
    const active=tab.path===state.currentPath?' active':'';
    return `<button type="button" class="preview-3d-tab${active}" data-3d-tab-path="${esc(tab.path)}" title="${esc(tab.path)}"><span>${esc(tab.name||fileName(tab.path))}</span><span class="preview-3d-tab-close" data-3d-tab-close="${esc(tab.path)}" aria-label="Close model tab">x</span></button>`;
  }).join('');
}
function addTab(path){
  if(!state) return;
  state.tabs=state.tabs.filter(tab=>tab.path!==path);
  state.tabs.unshift({path,name:fileName(path)});
  state.tabs=state.tabs.slice(0,16);
  saveTabs();
  renderTabs();
}
function closeTab(path){
  if(!state) return;
  const wasCurrent=state.currentPath===path;
  state.tabs=state.tabs.filter(tab=>tab.path!==path);
  saveTabs();
  renderTabs();
  if(wasCurrent){
    const next=state.tabs[0];
    if(next) openTab(next.path);
    else{
      if(state.object){
        state.scene.remove(state.object);
        disposeObject(state.object);
        state.object=null;
      }
      state.currentPath='';
      setStatusText('No 3D models open.');
      renderToolbarState();
    }
  }
}
function openTab(path){
  if(!state||!path||path===state.currentPath) return;
  loadModel(path).catch(err=>{
    console.warn('[three-viewer] tab load failed',err);
    setStatusText(`Could not load ${fileName(path)}: ${err.message||err}`,'error');
  });
}
function makeManager(basePath,sessionId){
  const manager=new THREE.LoadingManager();
  manager.setURLModifier(url=>{
    let value=String(url||'');
    if(!value||/^(?:data|blob):/i.test(value)) return value;
    if(value.includes('/api/file/raw')||value.startsWith('api/file/raw')) return value;
    try{
      const fileBase=new URL('api/file/',document.baseURI||location.href);
      const absolute=new URL(value,document.baseURI||location.href);
      if(absolute.href.startsWith(fileBase.href)) value=absolute.href.slice(fileBase.href.length);
    }catch(_){
      if(value.startsWith('api/file/')) value=value.slice('api/file/'.length);
    }
    const resolved=normalizeResourcePath(basePath,value);
    return rawUrl(sessionId,resolved);
  });
  return manager;
}
function loadVia(loader,url){
  return new Promise((resolve,reject)=>loader.load(url,resolve,undefined,reject));
}
async function fileInfo(path){
  if(!state||!state.sessionId) return null;
  try{
    if(typeof window.api==='function'){
      return await window.api(`/api/file/info?session_id=${encodeURIComponent(state.sessionId)}&path=${encodeURIComponent(path)}`,{timeoutMs:10000,timeoutToast:false});
    }
    const res=await fetch(`api/file/info?session_id=${encodeURIComponent(state.sessionId)}&path=${encodeURIComponent(path)}`,{credentials:'include'});
    if(!res.ok) return null;
    return await res.json();
  }catch(_){return null;}
}
async function loadTextFile(path){
  const res=await fetch(rawUrl(state.sessionId,path),{credentials:'include'});
  if(!res.ok) throw new Error(`Could not load ${fileName(path)}`);
  return await res.text();
}
async function siblingMtl(path){
  const stem=path.replace(/\.[^/.]+$/,'');
  const mtl=`${stem}.mtl`;
  const info=await fileInfo(mtl);
  return info&&info.size>=0?mtl:null;
}
function objMtlRefs(text){
  const refs=[];
  String(text||'').split(/\r?\n/).forEach(line=>{
    const m=line.match(/^\s*mtllib\s+(.+?)\s*$/i);
    if(!m) return;
    const ref=m[1].trim().replace(/^["']|["']$/g,'');
    if(ref) refs.push(ref);
  });
  return refs;
}
async function firstExistingMtl(path,objText){
  for(const ref of objMtlRefs(objText)){
    const resolved=normalizeResourcePath(path,ref);
    const info=await fileInfo(resolved);
    if(info&&info.size>=0) return resolved;
  }
  return await siblingMtl(path);
}
async function loadMtlMaterials(mtlPath){
  const manager=makeManager(mtlPath,state.sessionId);
  const text=await loadTextFile(mtlPath);
  const materials=new MTLLoader(manager).parse(text,'');
  materials.preload();
  return materials;
}
async function loadObjectForPath(path){
  const ext=fileExt(path);
  const sessionId=state.sessionId;
  const manager=makeManager(path,sessionId);
  const url=rawUrl(sessionId,path);
  if(ext==='.stl'){
    const geometry=await loadVia(new STLLoader(manager),url);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xc9d6e4,roughness:0.72,metalness:0.08}));
  }
  if(ext==='.ply'){
    const geometry=await loadVia(new PLYLoader(manager),url);
    if(!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    return new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xc9d6e4,roughness:0.72,metalness:0.08,vertexColors:!!geometry.getAttribute('color')}));
  }
  if(ext==='.obj'){
    const objLoader=new OBJLoader(manager);
    const objText=await loadTextFile(path);
    const mtlPath=await firstExistingMtl(path,objText);
    if(mtlPath){
      const materials=await loadMtlMaterials(mtlPath);
      objLoader.setMaterials(materials);
    }
    return objLoader.parse(objText);
  }
  if(ext==='.gltf'||ext==='.glb'){
    const gltf=await loadVia(new GLTFLoader(manager),url);
    return gltf.scene||gltf.scenes?.[0]||new THREE.Group();
  }
  if(ext==='.3mf'){
    return await loadVia(new ThreeMFLoader(manager),url);
  }
  throw new Error(`Unsupported 3D format: ${ext}`);
}
async function loadModel(path){
  const info=await fileInfo(path);
  if(info){
    const {warnBytes,maxBytes}=limits();
    if(info.size>maxBytes) throw new Error(`File is larger than the ${Math.round(maxBytes/1024/1024)} MB 3D viewer limit`);
    if(info.size>warnBytes) setStatusText(`Large model (${Math.round(info.size/1024/1024)} MB). Loading may take a moment.`,'warn');
    else setStatusText(`Loading ${fileName(path)}...`);
  }else{
    setStatusText(`Loading ${fileName(path)}...`);
  }
  const object=await loadObjectForPath(path);
  if(!state||state.disposed) return;
  if(state.object){
    state.scene.remove(state.object);
    disposeObject(state.object);
  }
  state.object=object;
  state.currentPath=path;
  state.basePath=dirName(path);
  state.scene.add(object);
  normalizeModel(object);
  restoreCameraState()||fitModel();
  applyWireframe();
  applyMaterialMode();
  addTab(path);
  renderToolbarState();
  setStatusText(`${fileName(path)} ready.`);
}
function normalizeModel(object){
  object.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(object);
  if(box.isEmpty()) return;
  const center=box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  object.updateMatrixWorld(true);
  const box2=new THREE.Box3().setFromObject(object);
  const size=box2.getSize(new THREE.Vector3()).length()||10;
  state.grid.scale.setScalar(Math.max(1,size/10));
  state.axes.scale.setScalar(Math.max(1,size/8));
}
function fitModel(){
  if(!state||!state.object) return;
  const box=new THREE.Box3().setFromObject(state.object);
  if(box.isEmpty()) return;
  const sphere=box.getBoundingSphere(new THREE.Sphere());
  const radius=Math.max(sphere.radius,0.1);
  const fov=THREE.MathUtils.degToRad(state.camera.fov);
  const dist=Math.abs(radius/Math.sin(fov/2))*1.25;
  state.camera.near=Math.max(0.001,dist/1000);
  state.camera.far=Math.max(1000,dist*1000);
  state.camera.position.copy(sphere.center).add(new THREE.Vector3(dist,dist*0.6,dist));
  state.camera.updateProjectionMatrix();
  state.controls.target.copy(sphere.center);
  state.controls.update();
  saveCameraState();
}
function resetView(){
  fitModel();
}
function saveCameraState(){
  if(!state||!state.sessionId||!state.currentPath) return;
  try{
    localStorage.setItem(storageViewKey(state.sessionId,state.currentPath),JSON.stringify({
      camera:state.camera.position.toArray(),
      target:state.controls.target.toArray(),
      wireframe:state.wireframe,
      materialMode:state.materialMode,
      grid:state.grid.visible,
      axes:state.axes.visible,
    }));
  }catch(_){}
}
function restoreCameraState(){
  if(!state||!state.sessionId||!state.currentPath) return false;
  try{
    const raw=localStorage.getItem(storageViewKey(state.sessionId,state.currentPath));
    if(!raw) return false;
    const data=JSON.parse(raw);
    if(Array.isArray(data.camera)&&data.camera.length===3) state.camera.position.fromArray(data.camera);
    if(Array.isArray(data.target)&&data.target.length===3) state.controls.target.fromArray(data.target);
    state.wireframe=!!data.wireframe;
    state.materialMode=data.materialMode==='clay'?'clay':'material';
    state.grid.visible=data.grid!==false;
    state.axes.visible=data.axes!==false;
    state.controls.update();
    renderToolbarState();
    return true;
  }catch(_){return false;}
}
function setNavigationMode(mode){
  state.navigationMode=mode==='pan'?'pan':'orbit';
  if(state.navigationMode==='pan'){
    state.controls.mouseButtons.LEFT=THREE.MOUSE.PAN;
    state.controls.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;
  }else{
    state.controls.mouseButtons.LEFT=THREE.MOUSE.ROTATE;
    state.controls.mouseButtons.RIGHT=THREE.MOUSE.PAN;
  }
  renderToolbarState();
}
function applyWireframe(){
  if(!state||!state.object) return;
  state.object.traverse(obj=>{
    const mats=Array.isArray(obj.material)?obj.material:[obj.material];
    mats.filter(Boolean).forEach(mat=>{mat.wireframe=!!state.wireframe;mat.needsUpdate=true;});
  });
  saveCameraState();
}
function applyMaterialMode(){
  if(!state||!state.object) return;
  state.object.traverse(obj=>{
    if(!obj.isMesh||!obj.material) return;
    if(state.materialMode==='clay'){
      if(!obj.userData.hermesOriginalMaterial) obj.userData.hermesOriginalMaterial=obj.material;
      obj.material=new THREE.MeshStandardMaterial({color:0xcbd5e1,roughness:0.78,metalness:0.04,wireframe:state.wireframe});
    }else if(obj.userData.hermesOriginalMaterial){
      obj.material=obj.userData.hermesOriginalMaterial;
      delete obj.userData.hermesOriginalMaterial;
      const mats=Array.isArray(obj.material)?obj.material:[obj.material];
      mats.filter(Boolean).forEach(mat=>{mat.wireframe=!!state.wireframe;});
    }
  });
  saveCameraState();
}
function screenshot(){
  if(!state) return;
  const a=document.createElement('a');
  a.href=state.renderer.domElement.toDataURL('image/png');
  a.download=(fileName(state.currentPath).replace(/\.[^.]+$/,'')||'model')+'-preview.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function zoomBy(factor){
  if(!state) return;
  const offset=state.camera.position.clone().sub(state.controls.target);
  if(offset.lengthSq()<=0) return;
  offset.multiplyScalar(factor);
  state.camera.position.copy(state.controls.target).add(offset);
  state.controls.update();
  saveCameraState();
}
function runTool(id){
  if(!state) return;
  const custom=customTools.find(tool=>tool.id===id);
  if(custom){
    custom.run(getContext());
    renderToolbarState();
    return;
  }
  if(id==='orbit') setNavigationMode('orbit');
  else if(id==='pan') setNavigationMode('pan');
  else if(id==='zoom-in') zoomBy(0.78);
  else if(id==='zoom-out') zoomBy(1.28);
  else if(id==='fit') fitModel();
  else if(id==='reset') resetView();
  else if(id==='grid') state.grid.visible=!state.grid.visible;
  else if(id==='axes') state.axes.visible=!state.axes.visible;
  else if(id==='wireframe'){state.wireframe=!state.wireframe;applyWireframe();}
  else if(id==='material'){state.materialMode=state.materialMode==='material'?'clay':'material';applyMaterialMode();}
  else if(id==='rotate') state.autoRotate=!state.autoRotate;
  else if(id==='screenshot') screenshot();
  renderToolbarState();
  saveCameraState();
}
function renderToolbarState(){
  if(!state) return;
  const customRoot=$('preview3dCustomTools');
  if(customRoot){
    customRoot.innerHTML=customTools.map(tool=>`<button type="button" class="preview-3d-tool" data-3d-tool="${esc(tool.id)}" title="${esc(tool.label||tool.id)}" aria-label="${esc(tool.label||tool.id)}" aria-pressed="false">${tool.icon?tool.icon:esc(tool.label||tool.id)}</button>`).join('');
    const sep=document.querySelector('.preview-3d-custom-sep');
    if(sep) sep.style.display=customTools.length?'':'none';
  }
  document.querySelectorAll('[data-3d-tool]').forEach(btn=>{
    const id=btn.dataset['3dTool'];
    let active=false;
    if(id==='orbit') active=state.navigationMode==='orbit';
    if(id==='pan') active=state.navigationMode==='pan';
    if(id==='grid') active=state.grid.visible;
    if(id==='axes') active=state.axes.visible;
    if(id==='wireframe') active=state.wireframe;
    if(id==='material') active=state.materialMode==='clay';
    if(id==='rotate') active=state.autoRotate;
    const custom=customTools.find(tool=>tool.id===id);
    if(custom&&typeof custom.isActive==='function') active=!!custom.isActive(getContext());
    btn.classList.toggle('active',active);
    btn.setAttribute('aria-pressed',active?'true':'false');
  });
}
function getContext(){
  return {
    state,
    THREE,
    sessionId:state&&state.sessionId,
    path:state&&state.currentPath,
    scene:state&&state.scene,
    camera:state&&state.camera,
    renderer:state&&state.renderer,
    controls:state&&state.controls,
    object:state&&state.object,
    fit:fitModel,
    saveCameraState,
  };
}
async function open(ctx){
  const s=ensureState();
  s.sessionId=ctx.sessionId;
  s.tabs=loadTabs(ctx.sessionId);
  renderTabs();
  renderToolbarState();
  await loadModel(ctx.path);
}
async function dispose(){
  disposeState();
}

window.Hermes3D={
  registerTool(tool){
    if(!tool||!tool.id||typeof tool.run!=='function') throw new Error('3D tool requires id and run(ctx)');
    const idx=customTools.findIndex(item=>item.id===tool.id);
    if(idx>=0) customTools.splice(idx,1,tool);
    else customTools.push(tool);
    renderToolbarState();
    return tool;
  },
  getContext,
  supportedExtensions:SUPPORTED_EXTS.slice(),
};

function registerViewer(){
  if(!window.HermesFileViewers) return false;
  window.HermesFileViewers.register({
    id:'three-3d-viewer',
    label:'3D model viewer',
    extensions:SUPPORTED_EXTS,
    priority:100,
    canPreview(ctx){return SUPPORTED_EXTS.includes(fileExt(ctx&&ctx.path));},
    open,
    dispose,
  });
  window.dispatchEvent(new Event('Hermes3DReady'));
  return true;
}
if(!registerViewer()){
  window.addEventListener('HermesFileViewersReady',registerViewer,{once:true});
}
