import {ConsoleStdout,File,OpenFile,WASI} from '@bjorn3/browser_wasi_shim';

const cdn='https://cdn.jsdelivr.net/';
const encoder=new TextEncoder();
let written=0;
function output(text) {
  if (!text || written>=60000) return;
  const entry=String(text).slice(0,60000-written);
  written+=entry.length;
  self.postMessage({type:'output',text:entry});
}

async function python(code,stdin) {
  const root=cdn+'pyodide/v314.0.8/full/';
  const {loadPyodide}=await import(root+'pyodide.mjs');
  const input=stdin.split('\n');
  const runtime=await loadPyodide({indexURL:root});
  runtime.setStdout({batched:line=>output(line+'\n')});
  runtime.setStderr({batched:line=>output(line+'\n')});
  runtime.setStdin({stdin:()=>input.shift()??null});
  const result=await runtime.runPythonAsync(code);
  if (result!==undefined&&result!==null) output(String(result)+'\n');
  result?.destroy?.();
  return 0;
}

async function cpp(code,stdin) {
  const compiler=await import(cdn+'npm/@yowasp/clang@21.1.4-3/gen/bundle.js');
  const decoder=new TextDecoder();
  const diagnostic=bytes=>bytes&&output(decoder.decode(bytes,{stream:true}));
  let files;
  try {
    files=await compiler.commands['clang++'](
      ['-std=c++20','-fno-exceptions','-O0','-fno-color-diagnostics','main.cpp','runtime.cpp','-o','main.wasm'],
      {'main.cpp':code,'runtime.cpp':'#include <cstdlib>\nextern "C" { void *__cxa_allocate_exception(size_t n) noexcept { return std::malloc(n); } void __cxa_throw(void *,void *,void *) { std::abort(); } }'},
      {stdout:diagnostic,stderr:diagnostic,decodeASCII:false}
    );
  } catch (error) {
    if (error instanceof compiler.Exit) return 1;
    throw error;
  } finally {output(decoder.decode());}
  if (!files?.['main.wasm']) throw Error('The compiler did not produce an executable.');
  const stdout=new TextDecoder();
  const stderr=new TextDecoder();
  const runtime=new WASI(['main'],[],[
    new OpenFile(new File(encoder.encode(stdin))),
    new ConsoleStdout(bytes=>output(stdout.decode(bytes,{stream:true}))),
    new ConsoleStdout(bytes=>output(stderr.decode(bytes,{stream:true})))
  ]);
  const {instance}=await WebAssembly.instantiate(files['main.wasm'],{wasi_snapshot_preview1:runtime.wasiImport});
  try {return runtime.start(instance);}
  finally {output(stdout.decode());output(stderr.decode());}
}

self.addEventListener('message',async ({data})=>{
  let exit=1;
  try {
    exit=await (data.language==='python'?python:cpp)(data.code,data.stdin);
  } catch (error) {output((error.message||String(error))+'\n');}
  self.postMessage({type:'done',exit});
},{once:true});
