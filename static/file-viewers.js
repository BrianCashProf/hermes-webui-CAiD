(function(){
  const viewers=[];
  let activeViewer=null;
  let activeCtx=null;

  function normalizeExt(ext){
    ext=String(ext||'').trim().toLowerCase();
    if(!ext) return '';
    return ext[0]==='.'?ext:'.'+ext;
  }

  function fileExtFromPath(path){
    const value=String(path||'');
    const i=value.lastIndexOf('.');
    return i>=0?value.slice(i).toLowerCase():'';
  }

  function normalizeViewer(viewer){
    if(!viewer||typeof viewer!=='object') throw new Error('viewer must be an object');
    if(!viewer.id) throw new Error('viewer id is required');
    if(typeof viewer.open!=='function') throw new Error('viewer open(ctx) is required');
    const extensions=Array.isArray(viewer.extensions)?viewer.extensions.map(normalizeExt).filter(Boolean):[];
    return {
      ...viewer,
      id:String(viewer.id),
      label:String(viewer.label||viewer.id),
      extensions,
      priority:Number.isFinite(Number(viewer.priority))?Number(viewer.priority):0,
    };
  }

  function register(viewer){
    const normalized=normalizeViewer(viewer);
    const idx=viewers.findIndex(item=>item.id===normalized.id);
    if(idx>=0) viewers.splice(idx,1,normalized);
    else viewers.push(normalized);
    viewers.sort((a,b)=>(b.priority||0)-(a.priority||0)||a.id.localeCompare(b.id));
    window.dispatchEvent(new CustomEvent('HermesFileViewerRegistered',{detail:{id:normalized.id}}));
    return normalized;
  }

  function matchingViewers(ctx){
    const ext=normalizeExt((ctx&&ctx.ext)||fileExtFromPath(ctx&&ctx.path));
    return viewers.filter(viewer=>{
      if(viewer.extensions.length&&viewer.extensions.indexOf(ext)<0) return false;
      if(typeof viewer.canPreview==='function'){
        try{return viewer.canPreview({...ctx,ext})!==false;}catch(_){return false;}
      }
      return true;
    });
  }

  function canPreview(ctx){
    return matchingViewers(ctx).length>0;
  }

  async function disposeActive(){
    const viewer=activeViewer;
    const ctx=activeCtx;
    activeViewer=null;
    activeCtx=null;
    if(viewer&&typeof viewer.dispose==='function'){
      try{await viewer.dispose(ctx);}catch(err){console.warn('[file-viewers] dispose failed',err);}
    }
  }

  async function open(ctx){
    const candidates=matchingViewers(ctx);
    if(!candidates.length) return false;
    const viewer=candidates[0];
    if(activeViewer&&activeViewer.id!==viewer.id) await disposeActive();
    activeViewer=viewer;
    activeCtx=ctx;
    await viewer.open(ctx);
    return true;
  }

  function list(){
    return viewers.map(viewer=>({
      id:viewer.id,
      label:viewer.label,
      extensions:[...viewer.extensions],
      priority:viewer.priority,
    }));
  }

  window.HermesFileViewers={
    register,
    canPreview,
    open,
    dispose:disposeActive,
    disposeActive,
    list,
    _matchingViewers:matchingViewers,
  };
  window.dispatchEvent(new Event('HermesFileViewersReady'));
})();
