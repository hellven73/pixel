const promptLimit=3072;

export function boundedInputs(tokenizer,{mode,messages,instructions,context}) {
  const system=[
    'You are PixelAI, an assistant for writing, learning, coding and games. Match the requested length and format.',
    mode==='writer' && 'Write a complete, developed draft: introduction, detailed paragraphs, and conclusion when appropriate. Follow the requested word count. Never invent sources.',
    mode==='illustration' && 'Draw the requested picture using SVG. Include a complete opening and closing svg element with viewBox="0 0 100 100". Use coloured shapes and put the background rectangle first. Return only the SVG. Never use external references.',
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
