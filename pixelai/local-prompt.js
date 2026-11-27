const promptLimit=1536;

export function boundedInputs(tokenizer,{messages,instructions,context}) {
  const system=[
    'You are PixelAI, a friendly Arcade assistant. Answer directly and keep replies concise.',
    instructions && 'Preferences: '+instructions,
    context && 'Available games (ID | title | category):\n'+context+
      '\nWhen suggesting a listed game, include its exact ID using [[game:ID]].'
  ].filter(Boolean).join('\n\n');
  const history=messages.slice(-9);
  for (;;) {
    while (history[0]?.role==='assistant') history.shift();
    const inputs=tokenizer.apply_chat_template([{role:'system',content:system},...history],{
      add_generation_prompt:true,return_dict:true
    });
    if (inputs.input_ids.dims[1]<=promptLimit) return inputs;
    for (const tensor of Object.values(inputs)) tensor?.dispose?.();
    if (history.length<=1) throw Error('This prompt is too long for the on-device model. Shorten the prompt, attachment or instructions.');
    history.shift();
  }
}
