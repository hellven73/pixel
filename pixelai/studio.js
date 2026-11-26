import {download} from './state.js';

const defaults={
  html:'<main><h1>Hello, PixelArcade</h1><button id="play">Press me</button></main>',
  css:'body { background: #161225; color: #f0eaff; font: 18px system-ui; padding: 2rem; }',
  javascript:'document.querySelector("#play").onclick = event => { event.target.textContent = "It works!"; };'
};
const names={html:'index.html',css:'style.css',javascript:'script.js'};

export function codeFrom(text) {
  const files={};
  for (const match of text.matchAll(/^```[ \t]*(html|css|javascript|js)[^\n]*\n([\s\S]*?)^```/gim)) {
    const language=match[1].toLowerCase().replace(/^js$/,'javascript');
    files[language]=(files[language]?files[language]+'\n':'')+match[2].trim();
  }
  return files;
}

export function sandboxDocument(project) {
  const policy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'";
  const style=project.css.replace(/<\/style/gi,'<\\/style');
  const script=JSON.stringify(project.javascript).replaceAll('<','\\u003c');
  return '<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="'+policy+'"><style>'+style+'</style>'+project.html+
    '<script>(()=>{const script=document.createElement("script");script.textContent='+script+';document.body.append(script);})();</script>';
}

export function createStudio(container,{loadRich,notify}) {
  container.innerHTML=`
    <header><h2>Creator Studio</h2><div class="studio-tools"><button data-mode="code">Code</button><button data-mode="preview">Preview</button><button id="studio-fullscreen">Fullscreen</button></div></header>
    <div class="studio-tools"><label>File <select id="studio-file"><option value="html">HTML</option><option value="css">CSS</option><option value="javascript">JavaScript</option></select></label><button id="studio-download-file">Download file</button><button id="studio-zip">Download ZIP</button></div>
    <div class="studio-code"><textarea class="studio-editor" aria-label="Edit project source" spellcheck="false"></textarea><pre aria-label="Highlighted source" tabindex="0"><code></code></pre></div>
    <iframe title="Sandboxed project preview" sandbox="allow-scripts" referrerpolicy="no-referrer" hidden></iframe>
    <span class="studio-project">Preview runs in an isolated frame.</span>`;
  const get=selector=>container.querySelector(selector);
  const select=get('#studio-file');
  const editor=get('textarea');
  const frame=get('iframe');
  let files={...defaults};
  let timer;
  const refresh=async()=>{
    const preview=get('code');
    const language=select.value;
    const value=editor.value;
    preview.textContent=value;
    try {
      const rich=await loadRich();
      if (value===editor.value && language===select.value) rich.highlight(preview,value,language==='html'?'xml':language);
    } catch { /* The plain editor stays available. */ }
  };
  const mode=value=>{
    get('.studio-code').hidden=value!=='code';
    frame.hidden=value!=='preview';
    for (const button of container.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed',String(button.dataset.mode===value));
    if (value==='preview') frame.srcdoc=sandboxDocument(files);
    else frame.removeAttribute('srcdoc');
  };
  select.onchange=()=>{editor.value=files[select.value];void refresh();};
  editor.oninput=()=>{
    files[select.value]=editor.value;
    clearTimeout(timer);
    timer=setTimeout(refresh,160);
  };
  get('#studio-download-file').onclick=()=>download(files[select.value],names[select.value]);
  get('#studio-zip').onclick=async()=>{
    try {
      const rich=await loadRich();
      let html=files.html;
      if (files.css && !/href\s*=\s*["'](?:\.\/)?style\.css["']/i.test(html)) {
        const link='<link rel="stylesheet" href="style.css">';
        html=/<\/head>/i.test(html)?html.replace(/<\/head>/i,link+'</head>'):link+'\n'+html;
      }
      if (files.javascript && !/src\s*=\s*["'](?:\.\/)?script\.js["']/i.test(html)) {
        const tag='<script src="script.js"></script>';
        html=/<\/body>/i.test(html)?html.replace(/<\/body>/i,tag+'</body>'):html+'\n'+tag;
      }
      download(rich.projectZip({'index.html':html,'style.css':files.css,'script.js':files.javascript}),'pixelai-project.zip','application/zip');
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
    close(){frame.removeAttribute('srcdoc');},
    load(project){
      files={html:'',css:'',javascript:'',...project};
      select.value=project.html?'html':Object.keys(project)[0];
      select.onchange();
      mode('code');
    }
  };
}
