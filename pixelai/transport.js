import {endpoint,turnstileSiteKey} from './config.js';

let session=null;
let signingIn;
let scriptPromise;
const widget=document.querySelector('#verification');

function service(path,options={}) {
  const base=new URL(endpoint);
  if (base.protocol!=='https:' && !['127.0.0.1','localhost'].includes(base.hostname)) throw Error('PixelAI needs an HTTPS API.');
  return fetch(new URL(path,base),{credentials:'omit',...options});
}

async function json(response) {
  let body;
  try { body=await response.json(); }
  catch { throw Error('The service returned an unreadable reply.'); }
  if (!response.ok) throw Object.assign(Error(body.error||'The service is unavailable.'),{status:response.status});
  return body;
}

export async function configuration(signal) {
  if (!endpoint || !turnstileSiteKey) return {ready:false,remaining:0,models:[]};
  return json(await service('/v1/config',{signal}));
}

function turnstile() {
  scriptPromise??=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async=true;
    const timeout=setTimeout(()=>failed(),12000);
    function failed() {
      clearTimeout(timeout);
      script.remove();
      reject(Error('Browser verification could not load. Check your connection and try again.'));
    }
    script.onload=()=>{
      clearTimeout(timeout);
      if (window.turnstile) resolve(window.turnstile);
      else failed();
    };
    script.onerror=failed;
    document.head.append(script);
  }).catch(error=>{scriptPromise=null;throw error;});
  return scriptPromise;
}

async function verify(signal,announce) {
  const api=await turnstile();
  if (signal.aborted) throw signal.reason;
  widget.hidden=false;
  announce('Verifying your browser…');
  let id;
  let stop;
  try {
    const token=await new Promise((resolve,reject)=>{
      stop=()=>reject(signal.reason);
      signal.addEventListener('abort',stop,{once:true});
      const fail=()=>reject(Error('Browser verification failed. Try sending again.'));
      id=api.render(widget,{
        sitekey:turnstileSiteKey,action:'pixelai',theme:'dark',appearance:'interaction-only',size:'flexible',
        callback:resolve,'error-callback':fail,'expired-callback':fail,'timeout-callback':fail
      });
    });
    return json(await service('/v1/session',{
      method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({token})
    }));
  } finally {
    signal.removeEventListener('abort',stop);
    if (id!==undefined) api.remove(id);
    widget.hidden=true;
  }
}

async function authorize(signal,announce) {
  signal.throwIfAborted();
  if (session?.expires>Date.now()+1500) return session.session;
  if (!signingIn || signingIn.controller.signal.aborted) {
    const controller=new AbortController();
    const pending={controller,users:0};
    signingIn=pending;
    pending.promise=verify(AbortSignal.any([controller.signal,AbortSignal.timeout(80000)]),announce)
      .then(value=>session=value).finally(()=>{if (signingIn===pending) signingIn=null;});
  }
  const pending=signingIn;
  pending.users++;
  let abort;
  try {
    const cancelled=new Promise((_,reject)=>{
      abort=()=>reject(signal.reason);
      signal.addEventListener('abort',abort,{once:true});
    });
    return (await Promise.race([pending.promise,cancelled])).session;
  } finally {
    signal.removeEventListener('abort',abort);
    if (--pending.users===0 && signingIn===pending) pending.controller.abort();
  }
}

export async function generate(payload,{signal,announce,onEvent}) {
  const token=await authorize(signal,announce);
  signal.throwIfAborted();
  const response=await service('/v1/chat',{
    method:'POST',signal,
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
    body:JSON.stringify(payload)
  });
  if (response.status===401) session=null;
  if (!response.ok) await json(response);
  if (!response.headers.get('content-type')?.includes('application/x-ndjson') || !response.body) throw Error('Streaming is unavailable.');
  const quota=response.headers.get('X-PixelAI-Remaining');
  if (quota!==null) onEvent({type:'quota',value:Number(quota)});
  const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending='', complete=false;
  try {
    while (!complete) {
      const chunk=await reader.read();
      if (chunk.done) break;
      pending+=chunk.value;
      let newline;
      while ((newline=pending.indexOf('\n'))!==-1) {
        const line=pending.slice(0,newline);
        pending=pending.slice(newline+1);
        if (!line.trim()) continue;
        const event=JSON.parse(line);
        if (event.type==='error') throw Error(event.message);
        onEvent(event);
        if (event.type==='done') { complete=true;break; }
      }
    }
    if (!complete) throw Error('The connection closed before the reply finished. You can retry.');
  } finally {
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}


export async function createImage(prompt,{signal,announce,onEvent}) {
  const token=await authorize(signal,announce);
  signal.throwIfAborted();
  announce('Creating image…');
  const response=await service('/v1/image',{
    method:'POST',signal,
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
    body:JSON.stringify({prompt})
  });
  if (response.status===401) session=null;
  if (!response.ok) await json(response);
  if (response.headers.get('content-type')?.split(';')[0]!=='image/jpeg') throw Error('The image service did not return an image.');
  const quota=response.headers.get('X-PixelAI-Remaining');
  if (quota!==null) onEvent({type:'quota',value:Number(quota)});
  return response.blob();
}
