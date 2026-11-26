const oldChatFiles=new Set(['ai-chat.js','ai-chat.css','ai-engine.js']);
export const removedArcadeFile=name=>oldChatFiles.has(name);

const patchNote=`<article>
    <h3>Meet PixelAI</h3>
    <time datetime="2026-11-27">27 November 2026</time>
    <p>Ask for Arcade game recommendations, compare free AI models, or bring generated code into Creator Studio. Conversations can be saved and exported from your browser.</p>
  </article>`;

export function updateArcadeHTML(html) {
  return html
    .replace('<head>','<head><script>window.pixelAILaunchId=new URLSearchParams(location.search).get("play")</script>')
    .replace(/<link\b[^>]*href="ai-chat\.css[^"]*"[^>]*>/gi,'')
    .replace(/((?:hub|tools)\.js)\?v=[^"]+/g,'$1?v=pixelai-1')
    .replace('<summary>Patch notes</summary>','<summary>Patch notes</summary>\n  '+patchNote);
}

export function updateTools(source) {
  return source
    .replace(/import '\.\/ai-chat\.js[^']*';\s*/,'')
    .replace("name:'Pixel AI'","name:'PixelAI'")
    .replace('showSection=function(next){',"showSection=function(next){if(next==='ai'){location.assign(new URL('../ai/',document.baseURI));return;}")
    .replace("for(const t of tools)document.querySelector('#'+t.id+'-page').hidden=next!==t.id;","for(const t of tools){const page=document.querySelector('#'+t.id+'-page');if(page)page.hidden=next!==t.id;}")
    .replace("if(next==='ai')window.pixelAI.show();",'')
    .replace(/integration\.js\?v=catalogue-3/,'integration.js?v=pixelai-1')
    .replace(/compact-ui\.js\?v=[^']+/,'compact-ui.js?v=pixelai-1');
}

export function updateCompactNav(source) {
  return source.replace("ai:'AI chat'","ai:'PixelAI'");
}

export function updateLocalLaunch(source) {
  return source.replace("const id=new URLSearchParams(location.search).get('play');","const id=window.pixelAILaunchId||new URLSearchParams(location.search).get('play');");
}

export function updateGameLaunch(source) {
  return source.replace('const featured=games.filter',`const aiPlay=window.pixelAILaunchId||new URLSearchParams(location.search).get('play');if(aiPlay?.startsWith('portal-')){const game=games.find(entry=>entry.id===aiPlay);if(game)openGame(game,true);}const featured=games.filter`);
}

export function updateManual(html) {
  return html
    .replace(/(<section\b[^>]*id="ai"[^>]*>)[\s\S]*?(<\/section>)/,
      '$1<h2>PixelAI</h2><p><a href="../ai/">Open PixelAI</a> to ask about games, get coding help, or compare free models. Chats are saved in this browser. Temporary chats are discarded when you leave. Messages you send go to the configured AI provider.</p>$2')
    .replace(' Your arcade account and Puter sign-in are separate.','')
    .replace(/(<dt>AI will not connect<\/dt>)<dd>[\s\S]*?<\/dd>/,
      '$1<dd>Finish the browser verification if prompted. Try another available model, or wait until the shared free quota resets at 00:00 UTC.</dd>');
}
