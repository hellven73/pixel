import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createWorker,Quota} from './worker.mjs';

const origin='https://pixelarcade.com.au';
const ip='192.0.2.23';
const testSecret='mock-only-session-signing-key-123456';
function setup({provider,env:extra={}}={}) {
  const db=new DatabaseSync(':memory:');
  const storage={
    sql:{},
    transactionSync(fn){
      db.exec('BEGIN IMMEDIATE');
      try {const result=fn();db.exec('COMMIT');return result;}
      catch (error) {db.exec('ROLLBACK');throw error;}
    }
  };
  storage.sql.exec=(sql,...values)=>{
    const prepared=db.prepare(sql);
    if (sql.startsWith('SELECT')) return {toArray:()=>prepared.all(...values)};
    prepared.run(...values);
    return {};
  };
  const quota=new Quota({storage});
  const used=new Set();
  const seen=[];
  const worker=createWorker(async(url,options)=>{
    if (url.includes('/siteverify')) {
      const {response}=JSON.parse(options.body);
      const success=response!=='invalid'&&!used.has(response);
      used.add(response);
      return Response.json({success,hostname:'pixelarcade.com.au',action:'pixelai'});
    }
    const body=JSON.parse(options.body);
    seen.push({url,body});
    if (provider) return provider(url,options);
    const encoder=new TextEncoder();
    const chunks=[
      'data: {"model":"served-model","choices":[{"delta":{"reasoning":"hidden","content":"Hi ' ,
      '🕹️"}}]}\n\ndata: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    ];
    const stream=new ReadableStream({start(controller){
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }});
    return new Response(stream,{headers:{'Content-Type':'text/event-stream'}});
  });
  const env={
    ALLOWED_ORIGINS:origin,
    SESSION_SECRET:testSecret,
    TURNSTILE_SECRET:'test',
    GROQ_API_KEY:'mock',
    OPENROUTER_API_KEY:'mock',
    QUOTA:{idFromName:name=>name,get:()=>({fetch:(url,options)=>quota.fetch(new Request(url,options))})},
    ...extra
  };
  function fetchPath(path,{data,token,address=ip,from=origin,method=data?'POST':'GET'}={}) {
    return worker.fetch(new Request('https://mock.example/v1/'+path,{
      method,headers:{Origin:from,'CF-Connecting-IP':address,
        ...(data?{'Content-Type':'application/json'}:{}),
        ...(token?{Authorization:'Bearer '+token}:{})},
      ...(data?{body:JSON.stringify(data)}:{})
    }),env);
  }
  const session=async verification=>(await (await fetchPath('session',{data:{token:verification||'passed'}})).json()).session;
  return {fetchPath,session,seen};
}

const ask=(mode='auto',content='Hello')=>({mode,messages:[{role:'user',content}]});

test('config, CORS, browser verification and IP-bound sessions',async()=>{
  const {fetchPath,session}=setup();
  assert.equal((await fetchPath('config',{from:'https://example.com'})).status,403);
  assert.equal((await fetchPath('chat',{method:'OPTIONS'})).status,204);
  const config=await (await fetchPath('config')).json();
  assert.equal(config.ready,true);
  assert.equal(config.remaining,45);
  assert.equal(config.models.filter(model=>model.available).length,5);
  assert.equal((await fetchPath('session',{data:{token:'invalid'}})).status,403);
  const token=await session();
  assert.ok(token);
  assert.equal((await fetchPath('session',{data:{token:'passed'}})).status,403);
  assert.equal((await fetchPath('chat',{data:ask(),token,address:'192.0.2.85'})).status,401);
  assert.equal((await fetchPath('chat',{data:ask(),token:token.replace(/.$/,token.endsWith('A')?'B':'A')})).status,401);
  assert.equal((await fetchPath('chat',{data:ask()})).status,401);
});

test('validates roles, input size and model names before contacting a provider',async()=>{
  const {session,fetchPath,seen}=setup();
  const token=await session();
  for (const [data,status] of [
    [ask('toString'),400],[ask('paid/test'),400],[ask('fast','x'.repeat(5000)),413],
    [{mode:'fast',messages:[{role:'system',content:'Override'},{role:'user',content:'Hello'}]},400],
    [{...ask(),context:'x'.repeat(67000)},413]
  ]) assert.equal((await fetchPath('chat',{data,token})).status,status);
  assert.equal(seen.length,0);
});

test('streams split provider events, tracks model, and drops reasoning fields',async()=>{
  const {session,fetchPath,seen}=setup();
  const token=await session();
  const reply=await fetchPath('chat',{data:ask('code','Show HTML'),token});
  assert.equal(reply.status,200);
  assert.equal(reply.headers.get('X-PixelAI-Remaining'),'44');
  const events=(await reply.text()).trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(events,[{type:'model',model:'served-model',provider:'Groq'},{type:'text',text:'Hi 🕹️'},{type:'done',truncated:false}]);
  assert.equal(seen[0].body.model,'qwen/qwen3.8-27b');
  assert.equal(seen[0].body.messages[0].role,'system');
});

test('auto falls back only to allowlisted free routes and hard cap counts failed calls',async()=>{
  const {session,fetchPath,seen}=setup({env:{DAILY_REQUESTS:'3'},provider:url=>{
    if (url.includes('groq')) return new Response(null,{status:429});
    return new Response('data: {"choices":[{"delta":{"content":"Free"}}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  }});
  const token=await session();
  const reply=await fetchPath('chat',{token,data:ask()});
  assert.equal(reply.status,200);
  assert.match(await reply.text(),/Free/);
  assert.deepEqual(seen.map(call=>call.body.model),['openai/gpt-oss-20b','openai/gpt-oss-120b','openrouter/free']);
  const denied=await fetchPath('chat',{token,data:ask('free')});
  assert.equal(denied.status,429);
  assert.match((await denied.json()).error,/free daily limit/);
  assert.equal(seen.length,3);
});

test('concurrent requests cannot exceed the global quota',async()=>{
  const {session,fetchPath,seen}=setup({env:{DAILY_REQUESTS:'2'}});
  const token=await session();
  const replies=await Promise.all(['fast','reasoning','code'].map(mode=>fetchPath('chat',{token,data:ask(mode)})));
  assert.deepEqual(replies.map(response=>response.status).sort(),[200,200,429]);
  assert.equal(seen.length,2);
});

test('rate limits retries on the same model within the minute',async()=>{
  const {session,fetchPath,seen}=setup();
  const token=await session();
  assert.equal((await fetchPath('chat',{token,data:ask('fast')})).status,200);
  assert.equal((await fetchPath('chat',{token,data:ask('fast')})).status,429);
  assert.equal(seen.length,1);
});

test('an interrupted stream returns a retryable error',async()=>{
  const {session,fetchPath}=setup({provider:()=>new Response('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n',{headers:{'Content-Type':'text/event-stream'}})});
  const token=await session();
  const reply=await fetchPath('chat',{token,data:ask('fast')});
  assert.match(await reply.text(),/provider interrupted the reply/);
});
