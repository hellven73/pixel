import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const type={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.woff2':'font/woff2'};
const server=createServer(async (request,response)=>{
  const {pathname}=new URL(request.url,'http://localhost');
  if (/\/ai\/config\.js$/.test(pathname)) {
    response.writeHead(200,{'Content-Type':'text/javascript'});
    return response.end("export const endpoint='https://pixelai.test';export const turnstileSiteKey='fixture';");
  }
  const pages=pathname.startsWith('/pixel/');
  const root=resolve(pages?(process.env.PAGES_OUTPUT||'origin-pages/github-pages-dist'):'vercel-dist');
  const path=resolve(root,'.'+(pages?pathname.slice(6):pathname));
  try {
    const final=(await stat(path)).isDirectory()?resolve(path,'index.html'):path;
    response.writeHead(200,{'Content-Type':type[extname(final)]||'application/octet-stream'});
    response.end(await readFile(final));
  } catch {response.statusCode=404;response.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
const regular=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce',acceptDownloads:true});
const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:2,reducedMotion:'reduce',hasTouch:true});
const models=[
  {id:'fast',name:'GPT Test Fast',label:'Fast',provider:'Groq',available:true,description:'Low reasoning'},
  {id:'reasoning',name:'GPT Test Reasoning',label:'Reasoning',provider:'Groq',available:true,description:'Medium reasoning'}
];
const seen=[];
const errors=[];
for (const context of [regular,mobile]) {
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await context.route('https://challenges.cloudflare.com/**',route=>route.fulfill({
    contentType:'text/javascript',
    body:'window.turnstile={render(el,opts){queueMicrotask(()=>opts.callback("mock"));return "mock"},remove(){}};'
  }));
  await context.route('https://pixelai.test/**',async route=>{
    const headers={
      'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization, Content-Type',
      'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Expose-Headers':'X-PixelAI-Remaining'
    };
    const path=new URL(route.request().url()).pathname;
    if (route.request().method()==='OPTIONS') return route.fulfill({status:204,headers});
    if (path.endsWith('/config')) return route.fulfill({json:{ready:true,remaining:45,models},headers});
    if (path.endsWith('/session')) return route.fulfill({json:{session:'mock-session',expires:Date.now()+900000},headers});
    const request=route.request().postDataJSON();
    seen.push(request);
    const source=request.messages.at(-1).content;
    if (source==='Test cancellation') {
      await new Promise(resolve=>setTimeout(resolve,850));
      return route.fulfill({status:503,headers,json:{error:'Slow provider'}}).catch(()=>{});
    }
    const answer=[
      'Try **Hextris** [[game:hextris-local]] and level up your rotation timing.',
      '',
      '<img src=x onerror=alert(1)> <script>window.xssFlag=true</script> [bad](javascript:alert%281%29)',
      '',
      '| A | B |\n| - | - |\n| 1 | 2 |',
      '',
      'Mass and energy can use $E=mc^2$. See https://example.org/physics.',
      '',
      '```python\nprint(42)\n```',
      '```cpp\nint main() { return 0; }\n```',
      '```html\n<main><button id="inside">Click me</button></main>\n```',
      '```css\nbody { background: #242424; color: white; }\n```',
      '```javascript\nlet blocked; try { parent.localStorage; blocked = false; } catch { blocked = true; } document.querySelector("#inside").onclick = () => { document.body.dataset.storage = String(blocked); };\n```'
    ].join('\n');
    return route.fulfill({
      status:200,headers:{...headers,'Content-Type':'application/x-ndjson','X-PixelAI-Remaining':'42'},
      body:[{type:'model',model:'Test model '+request.mode,provider:'Fixture'},{type:'text',text:answer},{type:'done',truncated:false}].map(event=>JSON.stringify(event)).join('\n')+'\n'
    });
  });
}
try {
  const page=await regular.newPage();
  await page.goto(origin+'/pixel/ai/');
  await page.getByRole('button',{name:'Send message'}).waitFor();
  if (process.env.PIXELAI_SCREENSHOTS) await page.screenshot({path:resolve(process.env.PIXELAI_SCREENSHOTS,'pixelai-desktop.png'),animations:'disabled'});
  assert.equal(await page.title(),'PixelAI · PixelArcade');
  const chat=page.getByRole('textbox',{name:'Message PixelAI'});
  await page.getByRole('button',{name:'Auto'}).click();
  await page.getByRole('button',{name:/^Fast /}).click();
  await page.getByRole('button',{name:'Find my next game'}).click();
  await chat.press('Enter');
  await page.locator('.katex').first().waitFor();
  assert.equal(seen[0].mode,'fast');
  assert.match(seen[0].context,/hextris-local/);
  const game=page.getByRole('link',{name:/Hextris Play in Arcade/});
  await game.waitFor();
  const gameUrl=await game.getAttribute('href');
  const answer=page.locator('.message.assistant');
  assert.equal(await answer.locator('img[onerror],script,a[href^="javascript:"]').count(),0);
  assert.equal(await answer.locator('table').count(),1);
  assert.equal(await answer.getByRole('button',{name:'Copy code'}).count(),5);
  assert.equal(await answer.getByRole('button',{name:'Preview',exact:true}).count(),2);
  const reference=answer.getByRole('link',{name:'https://example.org/physics'});
  assert.equal(await reference.getAttribute('target'),'_blank');
  assert.equal(await reference.evaluate(link=>getComputedStyle(link).color),'rgb(101, 173, 255)');
  assert.equal(await page.evaluate(()=>window.xssFlag),undefined);
  await page.getByRole('button',{name:'Open in Studio'}).click();
  await page.locator('#studio [data-mode=preview]').click();
  const frame=page.frameLocator('iframe[title="Sandboxed project preview"]');
  await frame.getByRole('button',{name:'Click me'}).click();
  assert.equal(await frame.locator('body').getAttribute('data-storage'),'true');
  const denied=await frame.locator('body').evaluate(async()=>{
    try {await fetch('https://example.org');return false;} catch {return true;}
  });
  assert.equal(denied,true);
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download ZIP'}).click();
  assert.equal((await downloaded).suggestedFilename(),'pixelai-project.zip');
  await page.locator('#studio [data-mode=code]').click();
  await page.locator('#studio-file').selectOption('javascript');
  await page.getByRole('textbox',{name:'Edit project source'}).fill('throw Error("timer could not mount");');
  await page.locator('#studio [data-mode=preview]').click();
  await page.getByText(/Preview error:.*timer could not mount/).waitFor();
  await page.getByRole('button',{name:'Ask PixelAI to fix'}).click();
  await page.getByText('Studio project',{exact:true}).waitFor();
  assert.match(await chat.inputValue(),/Fix this Studio project/);
  assert.equal(seen.length,1);
  await page.reload();
  await page.getByRole('link',{name:/Hextris Play in Arcade/}).waitFor();
  await page.locator('#file').setInputFiles({
    name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('Roll practice and rotation timing.')
  });
  await page.getByText('notes.txt',{exact:true}).waitFor();
  await chat.fill('A second turn');
  await chat.press('Enter');
  await page.locator('.message.assistant').nth(1).getByRole('button',{name:'Regenerate'}).waitFor();
  assert.equal(seen[1].messages.length,3);
  assert.match(seen[1].messages[2].content,/Roll practice/);
  await page.getByRole('button',{name:'Arena'}).click();
  await page.getByRole('textbox',{name:'Prompt'}).fill('Compare this');
  await page.getByRole('button',{name:'Compare models'}).click();
  await page.getByText('Comparison complete.').waitFor();
  await page.getByRole('button',{name:'Prefer this'}).nth(0).click();
  await page.getByText(/Preferred Test model fast/).waitFor();
  await page.getByRole('button',{name:'Close dialog'}).click();
  await page.keyboard.press('Control+k');
  await page.getByRole('button',{name:'Temporary chat'}).click();
  await page.locator('#temporary-badge').waitFor();
  await chat.fill('Test cancellation');
  await chat.press('Enter');
  await page.getByRole('button',{name:'Stop generation'}).click();
  await page.getByText('Reply stopped.').waitFor();
  await page.reload();
  assert.equal(await page.getByText('Test cancellation',{exact:true}).count(),0);
  const arcade=await regular.newPage();
  await arcade.goto(origin+'/pixel/arcade/');
  const legacy=arcade.locator('#side-nav [data-section=ai]');
  await legacy.waitFor({state:'attached'});
  assert.equal(await legacy.getAttribute('aria-label'),'PixelAI');
  assert.equal(await arcade.locator('script[src*="ai-chat"]').count(),0);
  await legacy.evaluate(node=>node.click());
  await arcade.waitForURL('**/pixel/ai/');
  const hextris=await regular.newPage();
  await hextris.goto(gameUrl);
  await hextris.locator('iframe[src*="hextris.html"]').waitFor({state:'attached'});
  const phone=await mobile.newPage();
  await phone.goto(origin+'/ai/');
  await phone.getByRole('button',{name:'Open history'}).click();
  await phone.getByRole('button',{name:'Settings'}).click();
  await phone.getByRole('heading',{name:'Settings'}).waitFor();
  await phone.getByRole('combobox',{name:'Theme'}).selectOption('ocean');
  await phone.getByRole('button',{name:'Save'}).click();
  assert.equal(await phone.locator('html').getAttribute('data-theme'),'ocean');
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if (process.env.PIXELAI_SCREENSHOTS) await phone.screenshot({path:resolve(process.env.PIXELAI_SCREENSHOTS,'pixelai-mobile.png'),animations:'disabled'});
  const device=await browser.newContext();
  const outbound=[];
  await device.route('**/*',route=>{
    if (route.request().url().startsWith(origin+'/')) return route.continue();
    outbound.push(route.request().url());return route.abort();
  });
  await device.route('**/ai/config.js',route=>route.fulfill({
    contentType:'text/javascript',body:"export const endpoint='';export const turnstileSiteKey='';"
  }));
  await device.addInitScript(()=>{
    Object.defineProperty(navigator,'gpu',{value:{}});
    window.workerStarts=0;
    window.Worker=class extends EventTarget {
      constructor() {super();window.workerStarts++;}
      postMessage({messages}) {
        if (messages.at(-1).content==='Test local cancellation') return;
        queueMicrotask(()=>{
          for (const data of [{type:'ready'},{type:'text',text:'Answer from this device.'},{type:'done'}]) {
            this.dispatchEvent(new MessageEvent('message',{data}));
          }
        });
      }
      terminate() {window.workerStopped=true;}
    };
  });
  const local=await device.newPage();
  await local.goto(origin+'/ai/');
  await local.getByRole('button',{name:'On-device',exact:true}).click();
  const localChoices=local.locator('#model-list');
  assert.equal(await localChoices.getByRole('button',{name:/^On-device LFM/}).getAttribute('aria-pressed'),'true');
  await localChoices.getByRole('button',{name:/^Advanced Qwen3.5/}).click();
  assert.equal(await local.evaluate(()=>window.workerStarts),0);
  await local.getByRole('button',{name:'Advanced',exact:true}).click();
  await localChoices.getByRole('button',{name:/^On-device LFM/}).click();
  const localPrompt=local.getByRole('textbox',{name:'Message PixelAI'});
  await localPrompt.fill('Keep this on this device');
  await local.getByRole('button',{name:'Send message'}).click();
  await local.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await localPrompt.inputValue(),'Keep this on this device');
  assert.equal(await local.evaluate(()=>window.workerStarts),0);
  await local.getByRole('button',{name:'Send message'}).click();
  await local.getByRole('button',{name:'Download model and send'}).click();
  await local.getByText('Answer from this device.',{exact:true}).waitFor();
  assert.equal(await local.evaluate(()=>window.workerStarts),1);
  const image=await local.evaluate(async()=>{
    const {illustration}=await import('./rich.js');
    return illustration('<circle cx="50" cy="50" r="40" onload="alert(1)" fill="url(https://bad.example/a)"/>').text();
  });
  assert.match(image,/<svg/);
  assert.match(image,/<circle/);
  assert.doesNotMatch(image,/onload|bad.example/);
  assert.deepEqual(outbound,[]);
  await localPrompt.fill('Test local cancellation');
  await local.getByRole('button',{name:'Send message'}).click();
  await local.getByRole('button',{name:'Stop generation'}).click();
  await local.getByText('Reply stopped.',{exact:true}).waitFor();
  assert.equal(await local.evaluate(()=>window.workerStopped),true);
  const modelUrl='https://huggingface.co/test/model/resolve/'+'1'.repeat(40)+'/onnx/model_q4.onnx';
  const cached=await local.evaluate(async key=>{
    const {modelStorage}=await import('./local-cache.js');
    const storage=await modelStorage();
    await storage.put(key,new Response('Fixture weight data'));
    return (await storage.match(key)).text();
  },modelUrl);
  assert.equal(cached,'Fixture weight data');
  await local.getByRole('button',{name:'Settings'}).click();
  await local.getByRole('button',{name:'Remove downloaded model'}).click();
  await local.getByText(/On-device model removed/).waitFor();
  assert.equal(await local.evaluate(async key=>{
    const {modelStorage}=await import('./local-cache.js');
    return Boolean(await (await modelStorage()).match(key));
  },modelUrl),false);
  await device.close();
  assert.deepEqual(errors,['timer could not mount']);
  console.log('Browser checks passed: desktop and mobile, Pages navigation, gameplay, cloud and on-device chat, Markdown, code, math, local history, context, Arena, cancellation, Studio isolation and ZIP.');
} finally {await browser.close();server.close();}
