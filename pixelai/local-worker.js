import {modelStorage} from './local-cache.js';
import {boundedInputs} from './local-prompt.js';

const repository='HuggingFaceTB/SmolLM2-360M-Instruct';
const revision='a10cc1512eabd3dde888204e902eca88bddb4951';
const responseLimit=384;
const send=message=>self.postMessage(message);
const status=message=>send({type:'status',message});
let model;
let device;
let tokenizer;
let TextStreamer;

async function loadModel() {
  status('Checking device capabilities…');
  const adapter=await navigator.gpu?.requestAdapter().catch(()=>null);
  device=adapter?.features.has('shader-f16')?'webgpu':'wasm';
  status(device==='webgpu'?'Preparing the WebGPU runtime…':'Preparing the CPU runtime…');
  const runtime=await import('./local-runtime/transformers.js');
  const {env}=runtime;
  ({TextStreamer}=runtime);
  env.allowLocalModels=false;
  // The tokenizer registry also makes unversioned metadata requests.
  env.remotePathTemplate='{model}/resolve/'+revision+'/';
  env.useBrowserCache=false;
  env.useWasmCache=false;
  env.customCache=await modelStorage();
  env.useCustomCache=Boolean(env.customCache);

  const binary=await fetch(new URL('./local-runtime/'+device+'.wasm.bin',import.meta.url),{credentials:'omit'});
  if (!binary.ok || !binary.body) throw Error('Could not load the on-device runtime. Reload PixelAI and try again.');
  const wasm=env.backends.onnx.wasm;
  wasm.numThreads=1;
  wasm.wasmPaths={mjs:new URL('./local-runtime/'+device+'.mjs',import.meta.url).href};
  wasm.wasmBinary=await new Response(binary.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();

  status('Loading model weights…');
  let previousProgress=-1;
  const progress_callback=event=>{
    if (event.status!=='progress'||!event.file?.endsWith('.onnx')||!event.total) return;
    const percent=Math.min(100,Math.floor(100*event.loaded/event.total));
    if (percent===previousProgress) return;
    previousProgress=percent;
    status(percent===100?'Starting the on-device model…':'Downloading model weights… '+percent+'%');
  };
  tokenizer=await runtime.AutoTokenizer.from_pretrained(repository,{revision});
  model=await runtime.AutoModelForCausalLM.from_pretrained(repository,{
    revision, device, dtype:device==='webgpu'?'q4f16':'q4', progress_callback
  });
}

self.addEventListener('message',async ({data})=>{
  let inputs;
  let result;
  try {
    if (!model) {
      try {await loadModel();}
      catch (error) {
        console.warn('PixelAI model setup:',error);
        const message=error.message?.startsWith('Could not load the on-device runtime')?error.message:
          'The on-device model could not load. Check your connection and available device memory, then retry.';
        send({type:'error',message,reset:true});
        return;
      }
    }
    send({type:'ready',device});
    status(device==='webgpu'?'Generating with WebGPU…':'Generating on this device’s CPU…');
    inputs=boundedInputs(tokenizer,data);
    let newTokens=0;
    let answered=false;
    const streamer=new TextStreamer(tokenizer,{
      skip_prompt:true,
      token_callback_function:()=>{newTokens++;},
      callback_function:text=>{
        answered ||= Boolean(text.trim());
        send({type:'text',text});
      }
    });
    result=await model.generate({...inputs,max_new_tokens:responseLimit,do_sample:false,streamer});
    if (!answered) throw Error('The on-device model returned an empty reply. Try a shorter or more specific prompt.');
    send({type:'done',truncated:newTokens>=responseLimit});
  } catch (error) {
    const reason=error?.message||'';
    const recoverable=/^(The on-device model returned|This prompt is too long)/.test(reason);
    if (!recoverable) console.warn('PixelAI local reply:',error);
    send({
      type:'error',reset:!recoverable,
      message:recoverable?reason:'The on-device model could not finish. Try a shorter prompt or restart the chat.'
    });
  } finally {
    result?.dispose();
    for (const tensor of Object.values(inputs||{})) tensor?.dispose?.();
  }
});
