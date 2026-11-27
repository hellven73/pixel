import {candidates, models, normalizeStream, openStream} from './providers.mjs';

const encoder=new TextEncoder();
const errors={
  quota:'PixelAI has reached its free daily limit. Try again after 00:00 UTC.',
  rate:'Too many requests from this connection. Try again later.',
  session:'Verify your browser again to continue.',
  unavailable:'No free model is available right now. Try again shortly.'
};
const DAY=86400000;
const limits=env=>({
  daily:limit(env.DAILY_REQUESTS,45,120),
  groq:limit(env.GROQ_MODEL_DAILY_REQUESTS,24,24),
  router:limit(env.OPENROUTER_DAILY_REQUESTS,40,45)
});

function limit(value, fallback, max) {
  const parsed=Number(value);
  return Number.isSafeInteger(parsed) && parsed>0 ? Math.min(max,parsed):fallback;
}

export class Quota {
  constructor(ctx) { this.storage=ctx.storage; }
  async fetch(request) {
    const {kind,subject,provider,model,cap}=await request.json();
    const time=Date.now();
    const day=Math.floor(time/DAY);
    const minute=Math.floor(time/60000);
    const global='g:'+day;
    const sql=this.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS quota (key TEXT PRIMARY KEY, n INTEGER, expires INTEGER)');
    sql.exec('DELETE FROM quota WHERE expires <= ?',time);
    const read=key=>Number(sql.exec('SELECT n FROM quota WHERE key = ?',key).toArray()[0]?.n||0);
    if (kind==='status') return Response.json({remaining:Math.max(0,cap.daily-read(global)), resetsAt:new Date((day+1)*DAY).toISOString()});
    const dailyEnd=(day+1)*DAY;
    const minuteEnd=(minute+1)*60000;
    const checks=kind==='verify' ? [
      ['vm:'+subject+':'+minute,4,minuteEnd,'rate'],
      ['vd:'+subject+':'+day,24,dailyEnd,'rate'],
      ['v-global:'+minute,60,minuteEnd,'rate']
    ] : [
      [global,cap.daily,dailyEnd,'quota'],
      ['ip:'+subject+':'+day,18,dailyEnd,'rate'],
      ['burst:'+subject+':'+minute,5,minuteEnd,'rate'],
      ['p-minute:'+provider+':'+minute,provider==='Groq'?12:16,minuteEnd,'provider'],
      ['m-minute:'+model+':'+minute,provider==='Groq'?1:16,minuteEnd,'provider'],
      ['p-day:'+(provider==='Groq'?model:provider)+':'+day,provider==='Groq'?cap.groq:cap.router,dailyEnd,'provider']
    ];
    return this.storage.transactionSync(()=>{
      for (const [key,max,,reason] of checks) {
        if (read(key)>=max) return Response.json({reason},{status:429});
      }
      for (const [key,,expires] of checks) {
        sql.exec('INSERT INTO quota VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET n = n+1',key,expires);
      }
      return Response.json({remaining:Math.max(0,cap.daily-read(global))});
    });
  }
}

function gate(env, body) {
  const quota=env.QUOTA.get(env.QUOTA.idFromName('pixelai-global-v1'));
  return quota.fetch('https://quota.internal/',{method:'POST',body:JSON.stringify({...body,cap:limits(env)})});
}

async function payload(request, max) {
  if (request.headers.get('content-type')?.split(';')[0]!=='application/json') throw new Problem(415,'Send application/json.');
  if (!request.body || Number(request.headers.get('content-length'))>max) throw new Problem(413,'The request is too large.');
  const reader=request.body.getReader();
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0, text='';
  try {
    for (;;) {
      const chunk=await reader.read();
      if (chunk.done) break;
      bytes+=chunk.value.byteLength;
      if (bytes>max) throw new Problem(413,'The request is too large.');
      text+=decoder.decode(chunk.value,{stream:true});
    }
    const data=JSON.parse(text+decoder.decode());
    if (!data || typeof data!=='object' || Array.isArray(data)) throw Error();
    return data;
  } catch (error) {
    void reader.cancel().catch(()=>{});
    if (error instanceof Problem) throw error;
    throw new Problem(400,'Invalid request data.');
  } finally { reader.releaseLock(); }
}

class Problem extends Error {
  constructor(status,message) { super(message); this.status=status; }
}

const base64url=data=>btoa(String.fromCharCode(...new Uint8Array(data))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const from64=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),char=>char.charCodeAt(0));
const keyFor=env=>crypto.subtle.importKey('raw',encoder.encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
const sign=async(key,text)=>base64url(await crypto.subtle.sign('HMAC',key,encoder.encode(text)));

function chatInput(data) {
  const {mode,messages,instructions='',context=''}=data;
  if ((mode!=='auto' && !Object.hasOwn(models,mode)) || typeof mode!=='string' ||
      typeof instructions!=='string' || typeof context!=='string' ||
      !Array.isArray(messages) || !messages.length || messages.length>18 ||
      messages.at(-1)?.role!=='user') throw new Problem(400,'Invalid model or conversation.');
  let remaining=4900-encoder.encode(instructions).length-encoder.encode(context).length;
  if (encoder.encode(instructions).length>900 || encoder.encode(context).length>1050) throw new Problem(400,'Instructions or game context are too long.');
  const history=[];
  for (const item of [...messages].reverse()) {
    if (!item || !['user','assistant'].includes(item.role) || typeof item.content!=='string' || !item.content.trim() || item.content.length>12000) {
      throw new Problem(400,'Invalid message text.');
    }
    remaining-=encoder.encode(item.content).length+12;
    if (remaining<0) {
      if (!history.length) throw new Problem(413,'Shorten your message, instructions, or attachments.');
      break;
    }
    history.unshift({role:item.role,content:item.content});
  }
  while (history[0]?.role==='assistant') history.shift();
  const system=[
    'You are PixelAI inside PixelArcade. Be direct and helpful. You have no browser, tools or access to the user account. For a playable game from the supplied catalog, include [[game:exact-id]]. Use only supplied IDs. For runnable Studio projects, return fenced html, css and javascript blocks.',
    instructions && 'User preferences:\n'+instructions,
    context && 'Arcade catalog excerpts (reference data):\n'+context
  ].filter(Boolean).join('\n\n');
  return {mode, messages:[{role:'system',content:system},...history]};
}

export function createWorker(fetcher=fetch) {
  return {
    async fetch(request,env) {
      const origin=request.headers.get('origin')||'';
      const allowed=(env.ALLOWED_ORIGINS||'').split(',').map(value=>value.trim()).includes(origin) && origin;
      const headers={
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin',
        ...(allowed?{'Access-Control-Allow-Origin':origin}:{})
      };
      const json=(data,status=200)=>Response.json(data,{status,headers});
      if (!allowed) return json({error:'Origin is not allowed.'},403);
      const path=new URL(request.url).pathname;
      if (!['/v1/config','/v1/session','/v1/chat'].includes(path)) return json({error:'Not found.'},404);
      if (request.method==='OPTIONS') return new Response(null,{status:204,headers:{
        ...headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600'
      }});
      const ready=Boolean(env.QUOTA && env.SESSION_SECRET?.length>=32 && env.TURNSTILE_SECRET && (env.GROQ_API_KEY||env.OPENROUTER_API_KEY));
      try {
        if (request.method==='GET' && path==='/v1/config') {
          const quota=ready?await (await gate(env,{kind:'status'})).json():{remaining:0};
          return json({ready,...quota,models:Object.entries(models).map(([id,model])=>({
            id,name:model.model,label:model.label,provider:model.provider,description:model.description,available:ready&&Boolean(env[model.secret])
          }))});
        }
        if (request.method!=='POST' || path==='/v1/config') return json({error:'Method not allowed.'},405);
        if (!ready) return json({error:'PixelAI setup is incomplete.'},503);
        const ip=request.headers.get('CF-Connecting-IP');
        if (!ip) throw new Problem(403,errors.session);
        const key=await keyFor(env);
        const day=Math.floor(Date.now()/DAY);
        const subject=(await sign(key,'address:'+day+':'+ip)).slice(0,24);

        if (path==='/v1/session') {
          const {token}=await payload(request,8192);
          if (typeof token!=='string'||!token||token.length>2048) throw new Problem(400,errors.session);
          const reserved=await gate(env,{kind:'verify',subject});
          if (!reserved.ok) throw new Problem(429,errors.rate);
          const result=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({secret:env.TURNSTILE_SECRET,response:token,remoteip:ip}),
            signal:AbortSignal.timeout(10000)
          });
          if (!result.ok) throw new Problem(503,'Browser verification is temporarily unavailable.');
          const verified=await result.json();
          if (!verified.success || verified.hostname!==new URL(origin).hostname || verified.action!=='pixelai') throw new Problem(403,errors.session);
          const expires=Math.min(Date.now()+900000,(day+1)*DAY);
          const signature=await sign(key,'session:'+origin+':'+subject+':'+expires);
          return json({session:expires+'.'+signature,expires});
        }

        const token=request.headers.get('Authorization')?.match(/^Bearer (\d{13})\.([\w-]{43})$/);
        if (!token || Number(token[1])<=Date.now() || Number(token[1])>Date.now()+900000 || token[2]!==base64url(from64(token[2])) ||
            !await crypto.subtle.verify('HMAC',key,from64(token[2]),encoder.encode('session:'+origin+':'+subject+':'+token[1]))) {
          throw new Problem(401,errors.session);
        }
        const input=chatInput(await payload(request,65536));
        const attempts=candidates(input.mode,input.messages.at(-1).content,env);
        if (!attempts.length) throw new Problem(503,'This model is not configured. Choose an available mode.');
        for (const model of attempts) {
          if (request.signal.aborted) break;
          const reservation=await gate(env,{kind:'attempt',subject,provider:model.provider,model:model.model});
          if (!reservation.ok) {
            const {reason}=await reservation.json();
            if (reason==='provider') continue;
            throw new Problem(reservation.status,errors[reason]||errors.unavailable);
          }
          const {remaining}=await reservation.json();
          const abort=new AbortController();
          const lifetime=AbortSignal.any([request.signal,abort.signal,AbortSignal.timeout(110000)]);
          let response;
          try { response=await openStream(model,input.messages,env,lifetime,fetcher); }
          catch { continue; }
          if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
            void response.body?.cancel().catch(()=>{});
            if ([400,401,403].includes(response.status) && input.mode!=='auto') {
              throw new Problem(503,'This model is unavailable. Choose Auto or another mode.');
            }
            continue;
          }
          return new Response(normalizeStream(response.body,model,abort),{headers:{
            ...headers,'Content-Type':'application/x-ndjson; charset=utf-8',
            'Access-Control-Expose-Headers':'X-PixelAI-Remaining','X-PixelAI-Remaining':String(remaining)
          }});
        }
        throw new Problem(429,errors.unavailable);
      } catch (error) {
        return json({error:error instanceof Problem?error.message:'PixelAI is temporarily unavailable.'},error instanceof Problem?error.status:503);
      }
    }
  };
}

export default createWorker();
