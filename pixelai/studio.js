import {download} from './state.js';
import {createCodePreview} from './code-preview.js';

const defaults={
  html:'<main><h1>Hello, PixelArcade</h1><button id="play">Press me</button></main>',
  css:'body { background: #161225; color: #f0eaff; font: 18px system-ui; padding: 2rem; }',
  javascript:'document.querySelector("#play").onclick = event => { event.target.textContent = "It works!"; };'
};
const names={html:'index.html',css:'style.css',javascript:'script.js',python:'main.py',cpp:'main.cpp'};

export function codeFrom(text) {
  const files={};
  for (const match of text.matchAll(/^```[ \t]*(html|css|javascript|js|python|py|cpp|cxx|c\+\+)(?:[ \t][^\n]*)?\n([\s\S]*?)^```/gim)) {
    const language=match[1].toLowerCase().replace(/^js$/,'javascript').replace(/^py$/,'python').replace(/^(cxx|c\+\+)$/,'cpp');
    files[language]=(files[language]?files[language]+'\n':'')+match[2].trim();
  }
  return files;
}

function reportPreview(token) {
  const send=(type,message)=>parent.postMessage({token,type,message},'*');
  addEventListener('error',event=>{
    if (event.message) send('error',event.message);
  });
  addEventListener('unhandledrejection',event=>send('error',String(event.reason)));
  addEventListener('load',()=>{
    const body=document.body;
    const hasText=body?.getClientRects().length&&body.innerText.trim();
    const hasControls=Array.from(body?.querySelectorAll('canvas,svg,img,video,button,input,select,textarea')||[])
      .some(node=>node.getBoundingClientRect().width>0&&getComputedStyle(node).visibility==='visible');
    send('ready',hasText||hasControls?'Preview loaded.':'The preview loaded without visible text, media or controls.');
  });
}

export function sandboxDocument(project,token) {
  const policy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'";
  const style=project.css.replace(/<\/style/gi,'<\\/style');
  const script=JSON.stringify(project.javascript).replaceAll('<','\\u003c');
  const reporter=token?'<script>('+reportPreview.toString()+')('+JSON.stringify(token)+');</script>':'';
  return '<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="'+policy+'">'+reporter+'<style>'+style+'</style>'+project.html+
    '<script>(()=>{const script=document.createElement("script");script.textContent='+script+';document.body.append(script);})();</script>';
}

export function createStudio(container,{loadRich,notify,attachProject}) {
  container.innerHTML=`
    <header><h2>Creator Studio</h2><div class="studio-tools"><button data-mode="code">Code</button><button data-mode="preview">Preview</button><button id="studio-fullscreen">Fullscreen</button></div></header>
    <div class="studio-tools"><label>File <select id="studio-file"><option value="html">HTML</option><option value="css">CSS</option><option value="javascript">JavaScript</option><option value="python">Python</option><option value="cpp">C++</option></select></label><button id="studio-download-file">Download file</button><button id="studio-zip">Download ZIP</button></div>
    <div class="studio-code"><textarea class="studio-editor" aria-label="Edit project source" spellcheck="false"></textarea><pre aria-label="Highlighted source" tabindex="0"><code></code></pre></div>
    <iframe title="Sandboxed project preview" sandbox="allow-scripts" referrerpolicy="no-referrer" hidden></iframe>
    <iframe class="code-isolate" title="Isolated code runtime" sandbox="allow-scripts" referrerpolicy="no-referrer" hidden></iframe>
    <div class="studio-console" hidden><label>Standard input<textarea placeholder="Optional input"></textarea></label><div class="studio-tools"><button id="studio-run">Run</button><button id="studio-stop">Stop</button></div><pre aria-label="Program output" role="log" tabindex="0"></pre></div>
    <div class="studio-tools"><span class="studio-project" role="status"></span><button id="studio-debug" type="button">Ask PixelAI to fix</button></div>`;

  const get=selector=>container.querySelector(selector);
  const select=get('#studio-file');
  const editor=get('textarea');
  const frame=get('iframe');
  const consolePanel=get('.studio-console');
  const result=consolePanel.querySelector('pre');
  const runner=createCodePreview(get('.code-isolate'),result,consolePanel.querySelector('textarea'));
  const executable=()=>['python','cpp'].includes(select.value);
  const start=()=>runner.run(select.value,files[select.value]);
  let view='code';
  let files={...defaults};
  let timer;
  let previewToken;
  let previewIssue='';
  const previewStatus=get('.studio-project');
  window.addEventListener('message',event=>{
    if (event.source!==frame.contentWindow || !previewToken || event.data?.token!==previewToken) return;
    const {type,message}=event.data;
    if (typeof message!=='string') return;
    if (type==='error'&&!previewIssue) previewIssue='Preview error: '+message.slice(0,240);
    if (type==='ready'||type==='error') previewStatus.textContent=previewIssue||message.slice(0,240);
  });
  get('#studio-debug').onclick=()=>{
    const sections=Object.entries(files).filter(([,source])=>source?.trim());
    const limit=Math.floor(3900/Math.max(sections.length,1));
    const source=sections.map(([language,value])=>names[language]+'\n'+value.slice(0,limit)+(value.length>limit?'\n[File excerpt]':''));
    const report=executable()?'Program output: '+result.textContent.slice(0,700):previewStatus.textContent;
    attachProject([report,...source].filter(Boolean).join('\n\n'));
  };
  const refresh=async()=>{
    const preview=get('code');
    const language=select.value;
    const value=editor.value;
    preview.textContent=value;
    try {
      const rich=await loadRich();
      if (value===editor.value && language===select.value) rich.highlight(preview,value,language==='html'?'xml':language);
    } catch {}
  };
  const mode=(value,autoRun=false)=>{
    view=value;runner.stop();
    get('.studio-code').hidden=value!=='code';
    consolePanel.hidden=value!=='preview'||!executable();
    frame.hidden=value!=='preview'||executable();
    for (const button of container.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed',String(button.dataset.mode===value));
    previewIssue='';
    previewToken=frame.hidden?null:crypto.randomUUID();
    previewStatus.textContent=frame.hidden?'Preview runs in an isolated frame.':'Loading browser preview…';
    if (previewToken) frame.srcdoc=sandboxDocument(files,previewToken);
    else frame.removeAttribute('srcdoc');
    if (!consolePanel.hidden) {
      result.textContent='Press Run to preview this program.';
      if (autoRun) void start();
    }
  };
  select.onchange=()=>{editor.value=files[select.value]||'';void refresh();if (view==='preview') mode('preview');};
  get('#studio-run').onclick=()=>void start();
  get('#studio-stop').onclick=()=>{runner.stop();result.append('\nStopped.');};
  editor.oninput=()=>{
    files[select.value]=editor.value;
    clearTimeout(timer);
    timer=setTimeout(refresh,160);
  };
  get('#studio-download-file').onclick=()=>download(files[select.value],names[select.value]);
  get('#studio-zip').onclick=async()=>{
    try {
      const rich=await loadRich();
      let html=files.html||'';
      if (files.css && !/href\s*=\s*["'](?:\.\/)?style\.css["']/i.test(html)) {
        const link='<link rel="stylesheet" href="style.css">';
        html=/<\/head>/i.test(html)?html.replace(/<\/head>/i,link+'</head>'):link+'\n'+html;
      }
      if (files.javascript && !/src\s*=\s*["'](?:\.\/)?script\.js["']/i.test(html)) {
        const tag='<script src="script.js"></script>';
        html=/<\/body>/i.test(html)?html.replace(/<\/body>/i,tag+'</body>'):html+'\n'+tag;
      }
      download(rich.projectZip({'index.html':html,'style.css':files.css,'script.js':files.javascript,...(files.python?{'main.py':files.python}:{}),...(files.cpp?{'main.cpp':files.cpp}:{})}),'pixelai-project.zip','application/zip');
    } catch { notify('The ZIP could not be created. Download the files individually.',true); }
  };
  get('#studio-fullscreen').onclick=async()=>{
    try {
      if (document.fullscreenElement===container) await document.exitFullscreen();
      else await container.requestFullscreen();
    } catch { notify('Fullscreen is unavailable in this browser.',true); }
  };
  for (const button of container.querySelectorAll('[data-mode]')) button.onclick=()=>mode(button.dataset.mode);
  return {
    open(){
      select.onchange();
      mode('code');
    },
    close(){runner.stop();previewToken=null;frame.removeAttribute('srcdoc');},
    run(){mode('preview',true);},
    load(project){
      files={html:'',css:'',javascript:'',...project};
      select.value=project.html?'html':Object.keys(project)[0];
      select.onchange();
      mode('code');
    }
  };
}
