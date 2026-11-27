import {modelStorage} from './local-cache.js';
import {boundedInputs} from './local-prompt.js';
import {localModels} from './local-models.js';
import {prefillChat} from './chat-prefill.js';

const send=message=>self.postMessage(message);
const status=message=>send({type:'status',message});
let model;
let device;
let tokenizer;
let runtime;
let processor;
let loadedRepository;

async function loadRuntime() {
  status('Checking device capabilities…');
  const adapter=await navigator.gpu?.requestAdapter().catch(()=>null);
  device=adapter?.features.has('shader-f16')?'webgpu':'wasm';
  status(device==='webgpu'?'Preparing the WebGPU runtime…':'Preparing the CPU runtime…');
  runtime=await import('./local-runtime/transformers.js');
  const {env}=runtime;
  env.allowLocalModels=false;
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

}
async function loadModel(mode) {
  if (!runtime) await loadRuntime();
  const {repository,revision}=localModels[mode];
  if (loadedRepository===repository) return;
  await model?.dispose();
  model=null;
  loadedRepository=undefined;
  processor=null;
  runtime.env.remotePathTemplate='{model}/resolve/'+revision+'/';
  status('Loading model weights…');
  const progressByFile=new Map();
  const progress_callback=event=>{
    if (event.status!=='progress'||!/\.onnx(?:_data(?:_\d+)?)?$/.test(event.file||'')||!event.total) return;
    const percent=Math.min(100,Math.floor(100*event.loaded/event.total));
    if (percent===progressByFile.get(event.file)) return;
    progressByFile.set(event.file,percent);
    status(percent===100?'Starting the on-device model…':'Downloading model weights… '+percent+'%');
  };
  const vision=mode==='vision';
  const dtype=localModels[mode][device];
  if (localModels[mode].chunkedChat && runtime.env.customCache) {
    const file='onnx/model_'+dtype+'.onnx_data';
    const url=new URL(repository+'/resolve/'+revision+'/'+file,runtime.env.remoteHost).href;
    const storage=runtime.env.customCache;
    const cached=await storage.match(url);
    if (cached) await cached.body?.cancel();
    else {
      const response=await fetch(url,{credentials:'omit'});
      if (!response.ok || !response.body) throw Error('Could not download the on-device model.');
      await storage.put(url,response,progress=>progress_callback({status:'progress',file,...progress}));
    }
    status('Starting the on-device model…');
  }
  const options={revision,device,dtype,...(!localModels[mode].chunkedChat&&{progress_callback})};
  if (vision) {
    processor=await runtime.AutoProcessor.from_pretrained(repository,{revision});
    processor.image_processor.size={longest_edge:device==='wasm'?512:1024};
    model=await runtime.AutoModelForImageTextToText.from_pretrained(repository,options);
    tokenizer=processor.tokenizer;
  } else {
    tokenizer=await runtime.AutoTokenizer.from_pretrained(repository,{revision});
    model=await runtime.AutoModelForCausalLM.from_pretrained(repository,options);
  }
  loadedRepository=repository;
}

self.addEventListener('message',async ({data})=>{
  let inputs;
  let result;
  let chatCache;
  try {
    if (loadedRepository!==localModels[data.mode].repository) {
      try {await loadModel(data.mode);}
      catch (error) {
        console.warn('PixelAI model setup:',error);
        const message=error.name==='QuotaExceededError'
          ?'There is not enough browser storage for this model. Free some space or select On-device Lite.'
          :error.message?.startsWith('Could not load the on-device runtime')?error.message
          :'The on-device model could not load. Check your connection and available device memory, then retry.';
        send({type:'error',message,reset:true});
        return;
      }
    }
    send({type:'ready',device});
    status(device==='webgpu'?'Generating with WebGPU…':'Generating on this device’s CPU…');
    const responseLimit=data.mode==='vision'?384:data.mode==='writer'?4096:2048;
    if (data.mode==='vision') {
      const image=await runtime.RawImage.fromBlob(data.image);
      const question=data.messages.at(-1).content;
      const text=processor.apply_chat_template([{role:'user',content:[{type:'image'},{type:'text',text:question}]}],{add_generation_prompt:true});
      inputs=await processor(text,[image],{do_image_splitting:device==='webgpu'});
    } else inputs=boundedInputs(tokenizer,data);
    let newTokens=0;
    let answered=false;
    const streamer=new runtime.TextStreamer(tokenizer,{
      skip_prompt:true,
      token_callback_function:()=>{newTokens++;},
      callback_function:text=>{
        answered ||= Boolean(text.trim());
        send({type:'text',text});
      }
    });
    const chatMode=localModels[data.mode].chunkedChat;
    if (chatMode) chatCache=await prefillChat(model,runtime,inputs,(done,total)=>status('Reading conversation… '+Math.round(done*100/total)+'%'));
    const sampling=chatMode?{do_sample:true,temperature:0.1,top_k:50,repetition_penalty:1.1}:{do_sample:false};
    result=await model.generate({...inputs,max_new_tokens:responseLimit,streamer,...sampling,
      ...(chatCache?{past_key_values:chatCache}:{})});
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
    if (chatCache) await chatCache.dispose().catch(()=>{});
    for (const tensor of Object.values(inputs||{})) tensor?.dispose?.();
  }
});
