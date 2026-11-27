import test from 'node:test';
import assert from 'node:assert/strict';
import {prefillChat} from '../pixelai/chat-prefill.js';
import {boundedInputs} from '../pixelai/local-prompt.js';
import {contextFor} from '../pixelai/state.js';
import {chatSystemPrompt,relevantGameQuery} from '../pixelai/chat-behavior.js';
import {localModels} from '../pixelai/local-models.js';

function mockTokenizer() {
  const calls=[];
  const tokenizer={apply_chat_template(messages,options){
    const tokenCount=messages.reduce((total,item)=>total+item.content.length+1,0);
    const call={messages,options,disposed:false};
    calls.push(call);
    return {input_ids:{dims:[1,tokenCount],dispose(){call.disposed=true;}}};
  }};
  return {tokenizer,calls};
}

test('local prompt preserves preferences, suggestions and the latest message',()=>{
  const {tokenizer,calls}=mockTokenizer();
  const messages=[{role:'user',content:'Recommend a puzzle'}];
  boundedInputs(tokenizer,{messages,instructions:'Be concise',context:'hextris-local | Hextris | Puzzle'});
  assert.equal(calls.length,1);
  assert.match(calls[0].messages[0].content,/Be concise/);
  assert.match(calls[0].messages[0].content,/hextris-local/);
  assert.equal(calls[0].messages.at(-1),messages[0]);
  assert.equal(calls[0].options.add_generation_prompt,true);
  assert.equal(calls[0].disposed,false);
});

test('context trimming drops complete old turns and frees rejected tensors',()=>{
  const {tokenizer,calls}=mockTokenizer();
  const messages=[
    {role:'user',content:'x'.repeat(2400)},
    {role:'assistant',content:'y'.repeat(1200)},
    {role:'user',content:'Keep this'},
  ];
  boundedInputs(tokenizer,{messages});
  assert.equal(calls.length,2);
  assert.equal(calls[0].disposed,true);
  assert.deepEqual(calls[1].messages.slice(1),[messages[2]]);
});

test('an over-limit latest message is rejected without silently truncating it',()=>{
  const {tokenizer,calls}=mockTokenizer();
  assert.throws(()=>boundedInputs(tokenizer,{messages:[{role:'user',content:'x'.repeat(4000)}]}),/too long/);
  assert.equal(calls[0].disposed,true);
});


test('on-device messages and attachments stay local after switching models',()=>{
  const chat={messages:[
    {role:'user',text:'Cloud turn'},
    {role:'assistant',text:'Cloud reply'},
    {role:'user',text:'Private turn',onDevice:true,file:{name:'notes.txt',text:'Private attachment'}},
    {role:'assistant',text:'Private reply',onDevice:true},
  ]};
  const current={role:'user',text:'New turn'};
  assert.deepEqual(contextFor(chat,current).map(message=>message.content),['Cloud turn','Cloud reply','New turn']);
  const local=contextFor(chat,{...current,onDevice:true});
  assert.match(local[2].content,/Private attachment/);
  assert.equal(local[3].content,'Private reply');
});

test('ordinary chat receives conversational instructions without arcade context',()=>{
  const games=[{name:'Hextris'}];
  for (const query of ['Hello','Write a Python chatbot','Make that answer shorter']) {
    assert.equal(relevantGameQuery(games,query,[{role:'user',content:query}]),'');
  }
  const prompt=chatSystemPrompt({mode:'local'});
  assert.match(prompt,/conversational AI chatbot/);
  assert.match(prompt,/Complete the requested work/);
  assert.match(prompt,/requested changes/);
  assert.doesNotMatch(prompt,/Available games/);
});

test('the default on-device model retains a substantial answer for the next turn',()=>{
  assert.equal(localModels.local.chunkedChat,true);
  assert.notEqual(localModels.local.repository,localModels.writer.repository);
  assert.notEqual(localModels.lite.repository,localModels.local.repository);
  const {tokenizer,calls}=mockTokenizer();
  const messages=[
    {role:'user',content:'Build a Python chatbot.'},
    {role:'assistant',content:'x'.repeat(4450)},
    {role:'user',content:'With more options: if I say like hello, you reply hello sir!'}
  ];
  boundedInputs(tokenizer,{mode:'local',messages});
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].messages.slice(1,-1),messages.slice(0,-1));
  assert.ok(calls[0].messages.at(-1).content.startsWith(messages.at(-1).content));
  assert.match(calls[0].messages.at(-1).content,/input\(\)/);
  assert.match(calls[0].messages.at(-1).content,/Map "hello" to the exact reply "hello sir!"/);
});

test('game discovery still uses relevant Arcade context',()=>{
  const games=[{name:'Hextris'}];
  const previous={role:'user',content:'Recommend three arcade games.'};
  const followup='Any more like that?';
  assert.equal(relevantGameQuery(games,'How do I play Hextris?',[]),'How do I play Hextris?');
  assert.equal(relevantGameQuery(games,followup,[previous,{role:'assistant',content:'Try Hextris.'},{role:'user',content:followup}]),previous.content+' '+followup);
});

test('long conversational model prompts extend the attention and convolution cache in chunks',async ()=>{
  class Tensor {
    constructor(type,data,dims) { Object.assign(this,{type,data,dims}); }
    dispose() { this.disposed=true; }
  }
  class DynamicCache {
    constructor(entries) { this.update(entries); }
    update(entries) { Object.assign(this,entries); }
  }
  const steps=[];
  const model={async forward({input_ids,attention_mask,past_key_values}) {
    const logits=new Tensor('float32',[],[1]);
    const key=new Tensor('float32',[],[1]);
    const conv=new Tensor('float32',[],[1]);
    steps.push({input_ids,attention_mask,previous:past_key_values?.['past_conv.0'],logits,key,conv});
    return {'present.0.key':key,'present_conv.0':conv,logits};
  }};
  const runtime={Tensor,DynamicCache,ones:dims=>new Tensor('int64',[],dims)};
  const ids={input_ids:{tolist:()=>[Array.from({length:520},(_,index)=>index)]}};
  const cache=await prefillChat(model,runtime,ids,()=>{});
  assert.deepEqual(steps.map(step=>step.input_ids.dims[1]),[256,256,7]);
  assert.deepEqual(steps.map(step=>step.attention_mask.dims[1]),[256,512,519]);
  assert.equal(steps[1].previous,steps[0].conv);
  assert.equal(steps[2].input_ids.data.at(-1),518n);
  assert.equal(cache['past_key_values.0.key'],steps[2].key);
  for (const step of steps) {
    assert.equal(step.logits.disposed,true);
    assert.equal(step.input_ids.disposed,true);
  }
});
