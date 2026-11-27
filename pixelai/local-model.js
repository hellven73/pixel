import {clearModelStorage} from './local-cache.js';

export const localModel={
  id:'local',
  name:'SmolLM2 360M Instruct',
  label:'On-device',
  description:'Runs in this browser. First use downloads about 285–400 MB. Uses WebGPU when supported, with a slower CPU mode.'
};

export function canUseLocalModel() {
  return globalThis.isSecureContext && typeof WebAssembly==='object' &&
    typeof Worker==='function' && typeof DecompressionStream==='function';
}

let worker;
let active;

function releaseWorker() {
  worker?.terminate();
  worker=undefined;
}

export function generateLocal(payload,{signal,announce,onEvent}) {
  signal.throwIfAborted();
  if (!canUseLocalModel()) throw Error('This browser does not support the features needed for on-device chat.');
  if (active) throw Error('The on-device model is already answering.');
  worker??=new Worker(new URL('./local-worker.js',import.meta.url),{type:'module'});

  return new Promise((resolve,reject)=>{
    const current=worker;
    const finish=(error,{reset=false}={})=>{
      if (active!==current) return;
      active=undefined;
      signal.removeEventListener('abort',cancel);
      current.removeEventListener('message',receive);
      current.removeEventListener('error',failed);
      if (reset) releaseWorker();
      if (error) reject(error);
      else resolve();
    };
    const cancel=()=>finish(signal.reason,{reset:true});
    const failed=()=>finish(Error('The on-device model could not start. Update your browser or select a cloud mode where available.'),{reset:true});
    const receive=({data})=>{
      switch (data.type) {
        case 'status': announce(data.message);break;
        case 'text': onEvent(data);break;
        case 'ready': onEvent({type:'model',model:localModel.name,provider:data.device==='wasm'?'On-device CPU':'On-device WebGPU'});break;
        case 'done': onEvent(data);finish();break;
        case 'error': finish(Error(data.message),{reset:data.reset});break;
      }
    };
    active=current;
    current.addEventListener('message',receive);
    current.addEventListener('error',failed);
    signal.addEventListener('abort',cancel,{once:true});
    current.postMessage(payload);
  });
}

export async function removeLocalModel() {
  if (active) throw Error('Stop the current on-device reply before removing the model.');
  releaseWorker();
  await clearModelStorage();
}
