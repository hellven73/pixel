const policy="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net; connect-src https://cdn.jsdelivr.net; worker-src blob:; form-action 'none'; base-uri 'none'";

export function runnerDocument(source) {
  const worker=JSON.stringify(source).replaceAll('<','\\u003c');
  return '<!doctype html><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="'+policy+'"><script>'+
    `const url=URL.createObjectURL(new Blob([${worker}],{type:'text/javascript'}));
    const runner=new Worker(url);
    runner.onmessage=event=>parent.postMessage(event.data,'*');
    runner.onerror=event=>parent.postMessage({type:'error',text:event.message},'*');
    addEventListener('message',event=>{
      if(event.source===parent) runner.postMessage(event.data);
    },{once:true});
    parent.postMessage({type:'ready'},'*');`+
    '</script>';
}

let runtimeSource;
export function createCodePreview(frame,output,stdin) {
  let cancel;
  const stop=()=>cancel?.();
  async function run(language,code) {
    stop();
    output.textContent='Loading '+(language==='python'?'Python':'C++')+' runtime…\n';
    const controller=new AbortController();
    const {signal}=controller;
    const listener=({source,data})=>{
      if (source!==frame.contentWindow) return;
      if (data?.type==='ready') frame.contentWindow.postMessage({language,code,stdin:stdin.value},'*');
      else if (data?.type==='output'&&typeof data.text==='string') output.append(data.text.slice(0,Math.max(0,65000-output.textContent.length)));
      else if (data?.type==='done') {
        output.append('\nExited with code '+Number(data.exit)+'.');
        close();
      } else if (data?.type==='error') {
        output.append('The preview runtime could not start.'+(data.text?' '+String(data.text).slice(0,250):''));
        close();
      }
    };
    const timer=setTimeout(()=>{
      output.append('\nPreview timed out.');
      close();
    },90000);
    function close() {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('message',listener);
      frame.removeAttribute('srcdoc');
      cancel=undefined;
    }
    cancel=close;
    try {
      runtimeSource??=fetch(new URL('./code-worker.js',import.meta.url)).then(response=>{
        if (!response.ok) throw Error('The preview runtime is unavailable.');
        return response.text();
      }).catch(error=>{runtimeSource=undefined;throw error;});
      const source=await runtimeSource;
      if (signal.aborted) return;
      window.addEventListener('message',listener);
      frame.srcdoc=runnerDocument(source);
    } catch (error) {
      if (signal.aborted) return;
      output.append(error.message);
      close();
    }
  }
  return {run,stop};
}
