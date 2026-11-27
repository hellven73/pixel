import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedInputs} from '../pixelai/local-prompt.js';

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
    {role:'user',content:'x'.repeat(1200)},
    {role:'assistant',content:'y'.repeat(600)},
    {role:'user',content:'Keep this'},
  ];
  boundedInputs(tokenizer,{messages});
  assert.equal(calls.length,2);
  assert.equal(calls[0].disposed,true);
  assert.deepEqual(calls[1].messages.slice(1),[messages[2]]);
});

test('an over-limit latest message is rejected without silently truncating it',()=>{
  const {tokenizer,calls}=mockTokenizer();
  assert.throws(()=>boundedInputs(tokenizer,{messages:[{role:'user',content:'x'.repeat(2000)}]}),/too long/);
  assert.equal(calls[0].disposed,true);
});
