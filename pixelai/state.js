const key='pixelai.workspace.v1';
const empty=()=>({chats:[],personas:[],settings:{theme:'arcade',model:'auto',localAllowed:false,instructions:'',memory:'',remember:false,persona:'general',folders:[]}});

export const builtIn=[
  {id:'general',icon:'✦',name:'Assistant',description:'General questions and ideas.',instructions:''},
  {id:'gaming',icon:'🎮',name:'Gaming Expert',description:'Game recommendations and walkthroughs.',instructions:'Give practical gaming advice and recommendations matched to the player.'},
  {id:'coding',icon:'⌘',name:'Coding Assistant',description:'Debugging, explanations, and browser projects.',instructions:'Explain trade-offs and give runnable examples.'},
  {id:'creative',icon:'✐',name:'Creative Writer',description:'Stories, scripts, and brainstorming.',instructions:'Offer original ideas with a voice that fits the requested audience.'},
  {id:'study',icon:'▤',name:'Study Assistant',description:'Step-by-step explanations and practice.',instructions:'Explain with examples and offer a brief practice exercise when helpful.'},
  {id:'developer',icon:'⬡',name:'Game Developer',description:'Browser game mechanics and prototyping.',instructions:'Prioritise original, playable mechanics and explain how to run the prototype.'}
];

export function load() {
  const defaults=empty();
  try {
    const data=JSON.parse(localStorage.getItem(key));
    if (!data) return defaults;
    return {
      chats:Array.isArray(data.chats)?data.chats.filter(chat=>chat?.id&&Array.isArray(chat.messages)):[],
      personas:Array.isArray(data.personas)?data.personas:[],
      settings:{...defaults.settings,...data.settings}
    };
  } catch { return defaults; }
}

export function save(state) {
  const snapshot={...state,chats:state.chats.map(chat=>({...chat,messages:chat.messages.filter(message=>!message.streaming)}))};
  localStorage.setItem(key,JSON.stringify(snapshot));
}
export const newChat=temporary=>({id:crypto.randomUUID(),title:'New chat',updated:Date.now(),messages:[],temporary,folder:'',pinned:false});
export const newMessage=(role,text)=>({id:crypto.randomUUID(),role,text});

export function contextFor(chat,current) {
  const history=chat.messages.filter(item=>item.text.trim()&&(current.onDevice||!item.onDevice)).slice(-17);
  return [...history,current].map(item=>({
    role:item.role,
    content:item.text+(item.file?.text?'\n\nAttached '+item.file.name+':\n'+item.file.text:'')
  }));
}

export function gameContext(games,prompt) {
  const terms=prompt.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[];
  return games.map(game=>{
    const text=(game.name+' '+game.category+' '+game.help).toLowerCase();
    return {game,score:terms.reduce((score,word)=>score+(game.name.toLowerCase().includes(word)?5:Number(text.includes(word))),0)};
  }).sort((a,b)=>b.score-a.score).slice(0,9)
    .map(({game})=>game.id+' | '+game.name+' | '+game.category).join('\n');
}

export function download(text,name,type='text/plain') {
  const url=URL.createObjectURL(new Blob([text],{type}));
  const anchor=Object.assign(document.createElement('a'),{href:url,download:name});
  anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function asMarkdown(chat) {
  return '# '+chat.title+'\n\n'+chat.messages.map(message=>
    '## '+(message.role==='user'?'You':'PixelAI')+'\n\n'+message.text+(message.file?'\n\nAttachment: '+message.file.name+'\n\n'+message.file.text:'')
  ).join('\n\n');
}
