export function chatSystemPrompt({mode,instructions,context}) {
  const core='You are PixelAI, a conversational AI chatbot. Reply naturally to casual messages and answer questions directly. Use earlier messages to understand follow-ups. Complete the requested work and include the requested changes when revising an answer. Give code in fenced blocks with language labels.';
  return [
    core,
    ['writer','essay'].includes(mode) && 'Write a complete draft with developed paragraphs. Follow the requested word count and do not invent citations.',
    mode==='illustration' && 'Draw the requested picture using SVG. Include a complete opening and closing svg element with viewBox="0 0 100 100". Use coloured shapes and put the background rectangle first. Return only the SVG. Never use external references.',
    instructions && 'User preferences:\n'+instructions,
    context && 'Available games (ID | title | category):\n'+context+
      '\nWhen suggesting a listed game, include its exact ID using [[game:ID]].'
  ].filter(Boolean).join('\n\n');
}

export function relevantGameQuery(games,query,messages) {
  const asksAboutGames=text=>/\b(games?|arcade|pixelarcade|gaming|gameplay|walkthrough|play something)\b/i.test(text)||
    games.some(game=>game.name.length>=4&&text.toLowerCase().includes(game.name.toLowerCase()));
  if (asksAboutGames(query)) return query;
  const previous=messages.at(-2)?.role==='assistant'?messages.at(-3):null;
  if (/^(?:and |what about |how about |which (?:one|is)|any (?:other|more)|more like |is it |does it )/i.test(query.trim()) &&
      previous?.role==='user' && asksAboutGames(previous.content)) return previous.content+' '+query;
  return '';
}

export function focusLocalRequest(messages) {
  const latest=messages.at(-1);
  if (!latest) return messages;
  const revision=/^(?:(?:can|could|would) you )?(?:with more|make (?:it|that|this)|change |add |remove |rewrite |revise |continue |do it |same but)/i.test(latest.content.trim());
  const userTopic=revision?messages.slice(-5).filter(message=>message.role==='user').map(message=>message.content).join(' '):latest.content;
  const aboutChatbot=/\b(chatbot|chat bot|terminal bot)\b/i.test(userTopic)||
    (revision&&/\b(say|reply|respond|greet)\b/i.test(latest.content));
  if (!/\bpython\b/i.test(userTopic)||!aboutChatbot) return messages;
  const guidance='Return one runnable Python script in a python code block. In a while loop, read input(), normalize the typed phrase with strip().lower(), and exit on quit. Use a dictionary mapping phrases to replies. Print the matching reply verbatim, with a fallback for unknown input.';
  const example=latest.content.match(/\bif (?:i|the user) (?:say|type) (?:like )?[“"']?([^,\n]+?)[”"']?,\s*(?:you|the bot|it) (?:should )?(?:say|reply(?: with)?|respond(?: with)?)\s+[“"']?([^\n]+?)[”"']?(?:\n|$)/i);
  const mapping=example?' Map '+JSON.stringify(example[1].trim())+' to the exact reply '+JSON.stringify(example[2].trim())+'.':'';
  const update=revision?' Revise the full script, keeping existing behavior unless I requested a change.':'';
  const content=latest.content+'\n\n'+guidance+update+mapping;
  return [...messages.slice(0,-1),{...latest,content}];
}
