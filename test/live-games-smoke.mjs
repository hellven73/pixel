import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';

const sites=['https://pixelarcade.com.au','https://hellven73.github.io/pixel'];
const expected=new Set(['hextris','2048','snakes','tetris','breakout','platformer','slope','quake-ii']);
const assets=['arcade/oss-games/2048/index.html','arcade/oss-games/2048/js/game_manager.js','arcade/oss-games/snakes/index.html','arcade/oss-games/tetris/index.html','arcade/oss-games/breakout/index.html','arcade/oss-games/platformer/index.html','arcade/cloudmoon.json'];

async function verify(base){
 const root=base+'/';
 const reply=await fetch(root+'catalogue.json?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(15000)});
 assert.equal(reply.status,200,root+'catalogue.json');
 const data=await reply.json();
 assert.equal(data.games.length,expected.size,base+' count');
 assert.deepEqual(new Set(data.games.map(game=>game.id)),expected,base+' games');
 for(const game of data.games){
  assert.equal(game.local,true,game.id);
  const url=new URL(game.url,root);
  assert.equal(url.origin,new URL(root).origin,game.id);
  assert.ok(url.pathname.startsWith(new URL('arcade/',root).pathname),game.id);
 }
 for(const path of assets){
  const response=await fetch(root+path,{method:'HEAD',signal:AbortSignal.timeout(15000),cache:'no-store'});
  assert.equal(response.status,200,root+path);
 }
 console.log('PASS',base,expected.size,'local games and',assets.length,'assets');
}

for(const base of sites){
 let failure;
 for(let attempt=0;attempt<18;attempt++){
  try{await verify(base);failure=null;break;}
  catch(error){failure=error;console.log('Retry',base,attempt+1,String(error));await sleep(10000);}
 }
 if(failure)throw failure;
}
