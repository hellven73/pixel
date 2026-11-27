const groq = 'https://api.groq.com/openai/v1/chat/completions';
const router = 'https://openrouter.ai/api/v1/chat/completions';

export const models = {
  fast: {provider:'Groq', secret:'GROQ_API_KEY', endpoint:groq, model:'openai/gpt-oss-20b', label:'Fast', description:'GPT-OSS 20B with low reasoning effort.', options:{reasoning_effort:'low',include_reasoning:false}},
  essay: {provider:'Groq', secret:'GROQ_API_KEY', endpoint:groq, model:'openai/gpt-oss-120b', label:'Cloud Writer', description:'Long essays and reports with an expanded response budget.', options:{reasoning_effort:'low',include_reasoning:false},maxOutput:6144},
  reasoning: {provider:'Groq', secret:'GROQ_API_KEY', endpoint:groq, model:'openai/gpt-oss-120b', label:'Reasoning', description:'GPT-OSS 120B with medium reasoning effort.', options:{reasoning_effort:'medium',include_reasoning:false}},
  code: {provider:'Groq', secret:'GROQ_API_KEY', endpoint:groq, model:'qwen/qwen3.8-27b', label:'Code', description:'Qwen 3.8 27B tuned for coding tasks.', options:{reasoning_format:'hidden',reasoning_effort:'low'}},
  creative: {provider:'Groq', secret:'GROQ_API_KEY', endpoint:groq, model:'qwen/qwen3.8-27b', label:'Creative', description:'Qwen 3.8 27B with increased sampling variety.', options:{temperature:0.95,reasoning_format:'hidden'}},
  free: {provider:'OpenRouter', secret:'OPENROUTER_API_KEY', endpoint:router, model:'openrouter/free', label:'Free rotation', description:'OpenRouter selects an available free model.', options:{}}
};

export function candidates(mode, text, env) {
  if (mode !== 'auto') return env[models[mode]?.secret] ? [models[mode]] : [];
  const first = /\b(essay|long-form|article|report|write-up)\b/i.test(text) ? 'essay' : /\b(debug|javascript|code|html|css|programming)\b/i.test(text) ? 'code'
    : /\b(prove|reason|analyse|analyze|equation|step by step)\b/i.test(text) ? 'reasoning'
    : /\b(story|poem|lyrics|creative|brainstorm)\b/i.test(text) ? 'creative' : 'fast';
  return [...new Set([first,'fast','reasoning','free'].map(key=>models[key]))].filter(model=>env[model.secret]);
}

export async function openStream(model, messages, env, signal, fetcher) {
  return fetcher(model.endpoint, {
    method:'POST',
    signal,
    headers:{
      'Authorization':'Bearer '+env[model.secret],
      'Content-Type':'application/json',
      ...(model.provider==='OpenRouter' ? {'HTTP-Referer':'https://pixelarcade.com.au','X-Title':'PixelAI'} : {})
    },
    body:JSON.stringify({
      model:model.model, messages, stream:true,
      [model.provider==='Groq'?'max_completion_tokens':'max_tokens']:model.maxOutput||4096,
      ...model.options
    })
  });
}

export function normalizeStream(stream, model, abort) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending='', done=false, hasText=false, finishReason=null, announced=false;
  const send = (controller,event)=>controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'));
  const announce = (controller,id)=>{
    if (announced) return;
    announced=true;
    send(controller,{type:'model',model:typeof id==='string'?id.slice(0,180):model.model,provider:model.provider});
  };
  const line = (controller,value)=>{
    if (!value.startsWith('data:')) return;
    const data=value.slice(5).trim();
    if (data==='[DONE]') {
      done=true;
      announce(controller);
      send(controller,hasText?{type:'done',truncated:finishReason==='length'}:{type:'error',message:'The model returned no visible answer. Try another mode.'});
      return;
    }
    const chunk=JSON.parse(data);
    if (chunk.error) throw Error('upstream');
    const choice=chunk.choices?.[0];
    if (choice?.finish_reason==='error' || choice?.finish_reason==='content_filter') throw Error('upstream');
    if (choice?.finish_reason) finishReason=choice.finish_reason;
    const text=choice?.delta?.content;
    if (typeof text==='string' && text) {
      announce(controller,chunk.model);
      hasText=true;
      send(controller,{type:'text',text});
    }
  };
  return new ReadableStream({
    async pull(controller) {
      try {
        const next=await reader.read();
        pending+=next.done?decoder.decode():decoder.decode(next.value,{stream:true});
        let newline;
        while (!done && (newline=pending.indexOf('\n'))>=0) {
          const value=pending.slice(0,newline);
          pending=pending.slice(newline+1);
          line(controller,value);
        }
        if (pending.length>65536) throw Error('oversized stream event');
        if (next.done && pending && !done) line(controller,pending);
        if (next.done && !done) throw Error('incomplete stream');
        if (done) {
          controller.close();
          void reader.cancel().catch(()=>{});
        }
      } catch {
        if (abort.signal.aborted) return controller.close();
        send(controller,{type:'error',message:'The provider interrupted the reply. You can retry.'});
        controller.close();
        void reader.cancel().catch(()=>{});
      }
    },
    async cancel() {
      abort.abort();
      await reader.cancel().catch(()=>{});
    }
  });
}
