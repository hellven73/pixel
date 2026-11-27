import {chatSystemPrompt,focusLocalRequest} from './chat-behavior.js';

const promptLimit=3072;

export function boundedInputs(tokenizer,{mode,messages,instructions,context}) {
  const system=chatSystemPrompt({mode,instructions,context});
  const limit=['local','writer','illustration'].includes(mode)?8192:promptLimit;
  const recent=messages.slice(-9);
  const history=mode==='illustration'?recent:focusLocalRequest(recent);
  for (;;) {
    while (history[0]?.role==='assistant') history.shift();
    const inputs=tokenizer.apply_chat_template([{role:'system',content:system},...history],{
      add_generation_prompt:true,return_dict:true,enable_thinking:false
    });
    if (inputs.input_ids.dims[1]<=limit) return inputs;
    for (const tensor of Object.values(inputs)) tensor?.dispose?.();
    if (history.length<=1) throw Error('This prompt is too long for the on-device model. Shorten the prompt, attachment or instructions.');
    history.shift();
  }
}
