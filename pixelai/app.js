import {asMarkdown,builtIn,contextFor,download,gameContext,load,newChat,newMessage,save} from './state.js';
import {configuration,generate} from './transport.js';
import {codeFrom,createStudio} from './studio.js';

const $=id=>document.getElementById(id);
const shell=$('shell'), sidebar=$('sidebar'), workspace=$('workspace'), prompt=$('prompt'), output=$('messages'), scroll=$('scroll');
const dialog=$('dialog'), dialogBody=$('dialog-body');
const mobile=matchMedia('(max-width:760px)');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const state=load();
let chat=state.chats[0]||newChat(false);
let service={ready:false,remaining:0,models:[]};
let games=[];
let attachment;
let run;
let arena;
let richPromise;
let studio;
let voice;
let dialogReturnFocus;

const library=fetch('games.json',{signal:AbortSignal.timeout(5000)}).then(response=>response.ok?response.json():[]).then(data=>games=data).catch(()=>[]);
const element=(tag,text,attrs={})=>{
  const node=document.createElement(tag);
  if (text!==null) node.textContent=text;
  for (const [name,value] of Object.entries(attrs)) node.setAttribute(name,value);
  return node;
};
function button(text,action,attrs={}) {
  const control=element('button',text,{type:'button',...attrs});
  control.onclick=action;
  return control;
}
function notify(text='',error=false) {
  $('status').textContent=text;
  $('status').dataset.error=String(error);
  if (error) shell.dataset.state='error';
  else if (shell.dataset.state==='error') shell.dataset.state='idle';
}
function persist() {
  try { save(state); }
  catch { notify('Browser storage is full or unavailable. Export chats before closing this page.',true); }
}
function applySettings() {
  document.documentElement.dataset.theme=state.settings.theme;
  const persona=[...builtIn,...state.personas].find(item=>item.id===state.settings.persona)||builtIn[0];
  $('persona-name').textContent=persona.name;
  updateModelLabel();
}
function updateModelLabel() {
  $('model-label').textContent=service.models.find(model=>model.id===state.settings.model)?.label||'Auto';
}
function loadRich() {
  if (!richPromise) {
    const link=element('link',null,{rel:'stylesheet',href:'katex.css'});
    document.head.append(link);
    richPromise=import('./rich.js').catch(error=>{link.remove();richPromise=null;throw error;});
  }
  return richPromise;
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    notify('Copied to clipboard.');
  } catch { notify('Clipboard access is unavailable. Select the text to copy it.',true); }
}
function setDrawer(open) {
  shell.classList.toggle(mobile.matches?'drawer':'collapsed',mobile.matches?open:!open);
  $('expand').setAttribute('aria-expanded',String(open));
  sidebar.inert=!open;
  workspace.inert=mobile.matches&&open;
}
function closeDrawer() { if (mobile.matches) setDrawer(false); }
function openDialog(title,content,className='') {
  if (!dialog.open) dialogReturnFocus=document.activeElement;
  if (mobile.matches && shell.classList.contains('drawer')) {
    closeDrawer();
    dialogReturnFocus=$('expand');
  }
  dialog.className=className;
  $('dialog-title').textContent=title;
  dialogBody.replaceChildren(content);
  if (!dialog.open) dialog.showModal();
}
dialog.addEventListener('close',()=>{
  if (arena) {arena.controllers.forEach(controller=>controller.abort());arena=null;}
  if (dialogReturnFocus instanceof HTMLElement) dialogReturnFocus.focus();
});
function form(submit,label='Save') {
  const node=element('form',null,{class:'fields'});
  node.onsubmit=event=>{event.preventDefault();submit();};
  node.confirm=element('button',label,{type:'submit'});
  return node;
}
function field(label,control) {
  const result=element('label',label);
  result.append(control);
  return result;
}
function select(options,value) {
  const control=element('select',null);
  for (const [id,label] of options) control.append(element('option',label,{value:id}));
  control.value=value;
  return control;
}
function textarea(value,limit,rows=4) {
  const control=element('textarea',null,{maxlength:limit,rows});
  control.value=value;
  return control;
}
function input(value,limit) {
  const control=element('input',null,{maxlength:limit,required:''});
  control.value=value;
  return control;
}
function checked(value) {
  const control=element('input',null,{type:'checkbox'});
  control.checked=value;
  return control;
}
function bottom() { scroll.scrollTop=scroll.scrollHeight; }
function nearBottom() { return scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<130; }
function resizePrompt() {
  prompt.style.height='auto';
  prompt.style.height=Math.min(prompt.scrollHeight,112)+'px';
}
function fill(value) {prompt.value=value;resizePrompt();prompt.focus();}
function syncControls() {
  $('stop').hidden=!run;
  $('send').hidden=Boolean(run);
  $('send').disabled=!service.ready||service.remaining===0;
  $('arena-button').disabled=!service.ready||service.remaining<2;
  $('temporary-badge').hidden=!chat.temporary;
}
function record(target) {
  target.updated=Date.now();
  if (target.temporary) return;
  if (!state.chats.some(item=>item.id===target.id)) state.chats.unshift(target);
  persist();
}
function selectedGameCards(target,text) {
  const ids=[...new Set([...text.matchAll(/\[\[game:([\w:-]+)\]\]/g)].map(match=>match[1]))];
  for (const id of ids.slice(0,6)) {
    const game=games.find(item=>item.id===id);
    if (!game) continue;
    const url=new URL('../arcade/index.html',location.href);
    url.searchParams.set('play',game.id);
    const card=element('a',null,{href:url.href,class:'game-card'});
    const thumb=element('img',null,{alt:'',loading:'lazy'});
    try {
      const cover=game.cover?new URL(game.cover,url):new URL('mark.svg',location.href);
      if (cover.origin===location.origin||cover.protocol==='https:') thumb.src=cover.href;
    } catch { thumb.src='mark.svg'; }
    thumb.onerror=()=>{thumb.onerror=null;thumb.src='mark.svg';};
    const label=element('span',game.name);
    label.append(element('small','Play in Arcade ↗'));
    card.append(thumb,label);
    target.append(card);
  }
}
function renderAnswer(target,text) {
  const clean=text.replace(/\[\[game:[\w:-]+\]\]/g,'').trim();
  target.textContent=clean;
  const preserveBottom=target.closest('.messages')&&nearBottom();
  if (clean) void loadRich().then(rich=>{
    if (!target.isConnected) return;
    target.classList.remove('plain');
    rich.markdown(target,clean,copy);
    selectedGameCards(target,text);
    if (preserveBottom) bottom();
  }).catch(()=>selectedGameCards(target,text));
  else selectedGameCards(target,text);
}
function row(message) {
  const isUser=message.role==='user';
  const article=element('article',null,{class:'message '+message.role});
  const heading=element('div',null,{class:'message-head'});
  if (!isUser) heading.append(element('img',null,{src:'mark.svg',width:'23',height:'23',alt:''}));
  heading.append(element('span',isUser?'You':message.model?'PixelAI · '+message.model:'PixelAI'));
  const body=element('div',message.text,{class:'message-body plain'});
  if (isUser && message.file) body.append(element('div','Attachment · '+message.file.name,{class:'attachment-chip'}));
  if (!isUser && !message.streaming) renderAnswer(body,message.text);
  const actions=element('div',null,{class:'message-actions'});
  if (isUser) actions.append(button('Edit & branch',()=>editMessage(message)));
  else if (!message.streaming) {
    if (message.text) {
      actions.append(button('Copy',()=>copy(message.text)));
      if ('speechSynthesis' in window) actions.append(button('Read aloud',()=>{
        const synth=window.speechSynthesis;
        if (synth.speaking) {synth.cancel();return;}
        synth.speak(new SpeechSynthesisUtterance(message.text.replace(/\[\[game:[\w:-]+\]\]/g,'')));
      }));
      const project=codeFrom(message.text);
      if (Object.keys(project).length) actions.append(button('Open in Studio',()=>toggleStudio(true,project)));
    }
    actions.append(button('Regenerate',()=>regenerate(message)));
    if (message.text) actions.append(button(message.feedback?'Feedback: '+message.feedback:'Feedback',()=>feedback(message)));
  }
  article.append(heading,body,actions);
  return {article,body};
}
function render(scrollToBottom=true) {
  const messages=chat.messages;
  $('welcome').hidden=Boolean(messages.length);
  output.hidden=!messages.length;
  output.replaceChildren(...messages.map(message=>row(message).article));
  if (run?.chat===chat) {
    const last=output.lastElementChild?.querySelector('.message-body');
    run.live=last;
    if (last && !last.textContent) last.textContent='Thinking…';
  }
  if (scrollToBottom) bottom();
  renderHistory();
  syncControls();
}
function renderHistory() {
  const history=$('history');
  const query=$('history-search').value.trim().toLowerCase();
  const visible=[...state.chats].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updated-a.updated)
    .filter(item=>!query||[item.title,item.folder,...item.messages.map(message=>message.text)].some(text=>(text||'').toLowerCase().includes(query)));
  const groups=new Map();
  for (const item of visible) {
    const group=item.pinned?'Pinned':item.folder||'Recent';
    if (!groups.has(group)) groups.set(group,[]);
    groups.get(group).push(item);
  }
  history.replaceChildren();
  if (!visible.length) history.append(element('p',query?'No matching conversations.':'Your saved chats appear here.'));
  for (const [name,items] of groups) {
    history.append(element('h2',name));
    for (const item of items) {
      const line=element('div',null,{class:'history-row'+(item===chat?' active':'')});
      const open=button(item.title,()=>switchChat(item),{'aria-current':item===chat?'true':'false',title:item.title});
      line.append(open,button('···',()=>chatActions(item),{'aria-label':'Manage '+item.title}));
      history.append(line);
    }
  }
}
function switchChat(target) {
  chat=target;
  closeDrawer();
  attachment=undefined;
  updateAttachment();
  fill('');
  const change=()=>render();
  if (document.startViewTransition && !reduced.matches && !run) document.startViewTransition(change);
  else change();
}
function createChat(temporary=false) {switchChat(newChat(temporary));}
function changeSettings() {persist();applySettings();}
function chatActions(target) {
  const actions=element('div',null,{class:'dialog-actions'});
  const name=input(target.title,80);
  const folders=select([['','No folder'],...state.settings.folders.map(item=>[item,item])],target.folder);
  const rename=form(()=>{
    target.title=name.value.trim()||'New chat';
    target.folder=folders.value;
    record(target);
    renderHistory();
    dialog.close();
  });
  rename.append(field('Title',name),field('Folder',folders),rename.confirm);
  actions.append(rename,button(target.pinned?'Unpin chat':'Pin chat',()=>{
    target.pinned=!target.pinned;record(target);renderHistory();dialog.close();
  }),button('Export Markdown',()=>download(asMarkdown(target),'pixelai-chat.md','text/markdown')),
  button('Export JSON',()=>download(JSON.stringify(target,null,2),'pixelai-chat.json','application/json')),
  button('Delete chat',()=>confirmAction('Delete this chat?',()=>{
    if (run?.chat===target) {run.discard=true;run.controller.abort();}
    state.chats=state.chats.filter(item=>item!==target);
    persist();
    if (chat===target) switchChat(state.chats[0]||newChat(false));
    else renderHistory();
  }),{class:'danger'}));
  openDialog('Manage chat',actions);
}
function confirmAction(title,action) {
  const controls=element('div',null,{class:'dialog-footer'});
  controls.append(button('Cancel',()=>dialog.close()),button('Delete',()=>{dialog.close();action();}));
  openDialog(title,controls);
}
function editMessage(message) {
  if (run) return notify('Stop the current reply before branching.');
  const edit=textarea(message.text,3200);
  const source=chat;
  const fields=form(()=>{
    if (!edit.value.trim()) return;
    dialog.close();
    branch(source,source.messages.indexOf(message),edit.value.trim(),message.file);
  },'Branch and send');
  fields.append(field('Edit message',edit),fields.confirm);
  openDialog('Branch conversation',fields);
}
function branch(source,index,text,file) {
  const next=newChat(source.temporary);
  next.title=source.title+' · Branch';
  next.folder=source.folder;
  next.messages=structuredClone(source.messages.slice(0,index));
  switchChat(next);
  attachment=file;
  updateAttachment();
  fill(text);
  $('composer').requestSubmit();
}
function regenerate(message) {
  if (run) return notify('Stop the current reply before regenerating.');
  const index=chat.messages.indexOf(message);
  const previous=chat.messages[index-1];
  if (previous?.role==='user') branch(chat,index-1,previous.text,previous.file);
}
function feedback(message) {
  const actions=element('div',null,{class:'dialog-footer'});
  for (const value of ['Helpful','Needs work','Clear']) actions.append(button(value,()=>{
    message.feedback=value==='Clear'?'':value;record(chat);dialog.close();render(false);
  }));
  openDialog('Feedback stored in this chat',actions);
}
function settings() {
  const theme=select([['arcade','Arcade violet'],['ocean','Ocean'],['ember','Ember']],state.settings.theme);
  const instructions=textarea(state.settings.instructions,260,2);
  const memory=textarea(state.settings.memory,180,2);
  const remember=checked(state.settings.remember);
  const footer=element('div',null,{class:'dialog-footer'});
  const fields=form(()=>{
    Object.assign(state.settings,{theme:theme.value,instructions:instructions.value,memory:memory.value,remember:remember.checked});
    changeSettings();dialog.close();
  });
  const memoryLabel=element('label','Use saved memory in requests');
  memoryLabel.prepend(remember);
  const allowance=service.ready?('Shared free requests remaining: '+service.remaining+' · resets at 00:00 UTC.'):('The inference service is waiting for deployment configuration.');
  fields.append(element('p',allowance),field('Theme',theme),field('Custom instructions',instructions),
    memoryLabel,field('Memory text',memory),fields.confirm,footer);
  footer.append(button('Clear memory',()=>{
    memory.value='';remember.checked=false;state.settings.memory='';state.settings.remember=false;changeSettings();
  }),button('New folder',createFolder),button('Delete all conversations',()=>confirmAction('Delete all saved chats?',()=>{
    if (run) {run.discard=true;run.controller.abort();}
    state.chats=[];persist();createChat();
  })));
  openDialog('Settings',fields);
}
function createFolder() {
  const name=input('',30);
  const fields=form(()=>{
    const value=name.value.trim();
    if (value && !state.settings.folders.includes(value)) state.settings.folders.push(value);
    changeSettings();settings();
  },'Create folder');
  fields.append(field('Folder name',name),fields.confirm);
  openDialog('New folder',fields);
}
function personas() {
  const list=element('div',null,{class:'dialog-actions'});
  for (const persona of [...builtIn,...state.personas]) {
    list.append(button(persona.icon+' '+persona.name+' · '+persona.description,()=>{
      state.settings.persona=persona.id;changeSettings();dialog.close();
    },{'aria-pressed':String(state.settings.persona===persona.id)}));
    if (state.personas.includes(persona)) list.append(button('Edit '+persona.name,()=>editPersona(persona)));
  }
  list.append(button('Create persona',()=>editPersona()));
  openDialog('Personas',list);
}
function editPersona(existing) {
  const name=input(existing?.name||'',22);
  const icon=input(existing?.icon||'✦',8);
  const description=input(existing?.description||'',55);
  const instructions=textarea(existing?.instructions||'',160,3);
  const fields=form(()=>{
    if (!name.value.trim()||!description.value.trim()) return;
    const item={id:existing?.id||crypto.randomUUID(),name:name.value.trim(),icon:icon.value.trim()||'✦',description:description.value.trim(),instructions:instructions.value.trim()};
    state.personas=state.personas.filter(persona=>persona.id!==item.id).concat(item);
    state.settings.persona=item.id;changeSettings();personas();
  });
  fields.append(field('Name',name),field('Icon',icon),field('Description',description),field('Instructions',instructions),fields.confirm);
  if (existing) fields.append(button('Delete persona',()=>{
    state.personas=state.personas.filter(item=>item!==existing);
    if (state.settings.persona===existing.id) state.settings.persona='general';
    changeSettings();personas();
  }));
  openDialog(existing?'Edit persona':'Create persona',fields);
}
function commands() {
  const query=element('input',null,{placeholder:'Search commands',type:'search','aria-label':'Search commands'});
  const list=element('div',null,{class:'dialog-actions'});
  const actions=[
    ['New chat',()=>createChat()],['Temporary chat',()=>createChat(true)],['Find a conversation',()=>{setDrawer(true);$('history-search').focus();}],
    ['Creator Studio',()=>toggleStudio()],['AI Arena',openArena],['Personas',personas],['Settings',settings],
    ['Prompt library',promptLibrary],['Toggle focus mode',toggleFocus]
  ];
  if (chat.messages.length) actions.push(['Manage current chat',()=>chatActions(chat)]);
  const update=()=>{
    list.replaceChildren(...actions.filter(([label])=>label.toLowerCase().includes(query.value.toLowerCase()))
      .map(([label,action])=>button(label,()=>{dialog.close();requestAnimationFrame(action);})));
  };
  query.oninput=update;update();
  const content=element('div',null,{class:'dialog-actions'});
  content.append(query,list);openDialog('Commands',content);query.focus();
}
function promptLibrary() {
  const content=element('div',null,{class:'dialog-actions'});
  const prompts=[
    ...[...document.querySelectorAll('[data-prompt]')].map(item=>item.dataset.prompt),
    'Turn this topic into five short quiz questions.',
    'Review my code and explain the smallest fix.',
    'Give me three original game mechanics that work with a single key.'
  ];
  for (const value of prompts) content.append(button(value,()=>{dialog.close();fill(value);}));
  openDialog('Prompt library',content);
}
function instructions() {
  const persona=[...builtIn,...state.personas].find(item=>item.id===state.settings.persona);
  return [persona?.instructions,state.settings.instructions,state.settings.remember?state.settings.memory:''].filter(Boolean).join('\n');
}
function request(mode,messages,query) {
  return {mode,messages,instructions:instructions(),context:gameContext(games,query)};
}
function quota(value,conservative=false) {
  if (Number.isFinite(value)) service.remaining=conservative?Math.min(service.remaining,value):value;
  syncControls();
}
async function configure() {
  try {
    service=await configuration(AbortSignal.timeout(10000));
    if (service.ready&&!service.models.some(model=>model.id===state.settings.model&&model.available)) state.settings.model='auto';
    notify(service.ready?'':'Chat service setup is pending. Local tools and saved chats are available.');
  } catch (error) {notify('Could not connect to PixelAI. Reload to retry.',true);}
  applySettings();syncControls();
}
function liveUpdate(job) {
  if (job.frame) return;
  job.frame=requestAnimationFrame(()=>{
    job.frame=null;
    if (!job.live || job.chat!==chat) return;
    const follow=nearBottom();
    job.live.textContent=job.answer.text;
    if (follow) bottom();
  });
}
async function send(text) {
  if (run||!service.ready||service.remaining===0||!text.trim()) return;
  const user={...newMessage('user',text),...(attachment?{file:attachment}:{})};
  const answer={...newMessage('assistant',''),streaming:true};
  const target=chat;
  const payload=request(state.settings.model,contextFor(target,user),text);
  if (new TextEncoder().encode(payload.messages.at(-1).content+' '+payload.instructions+' '+payload.context).length>4750) {
    return notify('This message is too long. Shorten the prompt or attachment.',true);
  }
  attachment=undefined;updateAttachment();fill('');
  target.messages.push(user,answer);
  if (target.title==='New chat') target.title=text.replace(/\s+/g,' ').slice(0,56);
  if (!target.temporary) {
    if (!state.chats.includes(target)) state.chats.unshift(target);
    target.updated=Date.now();
    persist();
  }
  const job=run={chat:target,controller:new AbortController(),answer,live:null,frame:null};
  shell.dataset.state='processing';
  notify('Preparing reply…');
  render();
  try {
    await library;
    payload.context=gameContext(games,text);
    if (new TextEncoder().encode(payload.messages.at(-1).content+' '+payload.instructions+' '+payload.context).length>4750) {
      throw Error('This message is too long. Shorten the prompt or attachment.');
    }
    const signal=AbortSignal.any([job.controller.signal,AbortSignal.timeout(125000)]);
    await generate(payload,{signal,announce:notify,onEvent:event=>{
      if (event.type==='quota') quota(event.value);
      if (event.type==='model') {answer.model=event.model;answer.provider=event.provider;}
      if (event.type==='text') {
        const first=!answer.text;
        answer.text+=event.text;
        if (first) {shell.dataset.state='responding';notify('Replying…');}
        liveUpdate(job);
      }
      if (event.type==='done') notify(event.truncated?'The reply reached the model’s output limit.':'');
    }});
  } catch (error) {
    if (!answer.text) answer.failed=true;
    notify(job.controller.signal.aborted?'Reply stopped.':error.name==='TimeoutError'?'The reply timed out. Try again.':error.message,!job.controller.signal.aborted);
    if (error.status===429) void configuration(AbortSignal.timeout(8000)).then(data=>quota(data.remaining)).catch(()=>{});
  } finally {
    if (job.frame) cancelAnimationFrame(job.frame);
    delete answer.streaming;
    run=null;
    if (!job.discard) record(target);
    if (shell.dataset.state!=='error') shell.dataset.state='idle';
    render(chat===target&&nearBottom());
  }
}
function updateAttachment() {
  const chip=$('attachment-chip');
  chip.hidden=!attachment;
  chip.querySelector('span').textContent=attachment?attachment.name:'';
}
async function attach(file) {
  if (!file) return;
  try {
    let text;
    if (/\.pdf$/i.test(file.name)) {
      if (file.size>3000000) throw Error('Choose a PDF under 3 MB.');
      notify('Extracting PDF text…');
      const pdf=await import('./pdf.js');
      pdf.GlobalWorkerOptions.workerSrc=new URL('./pdf.worker.js',import.meta.url).href;
      const task=pdf.getDocument({data:await file.arrayBuffer(),disableFontFace:true,isEvalSupported:false,enableXfa:false,useSystemFonts:false});
      try {
        const document=await task.promise;
        const pages=[];
        for (let page=1;page<=Math.min(document.numPages,7)&&pages.join('\n').length<2000;page++) {
          const content=await (await document.getPage(page)).getTextContent();
          pages.push(content.items.map(item=>item.str||'').join(' '));
        }
        text=pages.join('\n');
        if (!text.trim()) throw Error('No selectable text was found in this PDF.');
      } finally {await task.destroy();}
    } else {
      if (!/\.(txt|md|json|csv|js|css|html)$/i.test(file.name)||file.size>100000) throw Error('Choose a supported text file under 100 KB.');
      text=await file.text();
    }
    if (!text.trim()) throw Error('This file has no text.');
    attachment={name:file.name.slice(0,90),text:text.slice(0,1750)};
    updateAttachment();notify(text.length>1750?'Attached the first 1,750 characters.':'');prompt.focus();
  } catch (error) {notify(error.message,true);}
}
function toggleStudio(open=$('studio').hidden,project) {
  if (open) {
    studio??=createStudio($('studio'),{loadRich,notify});
    if ($('studio').hidden) studio.open();
    if (project) studio.load(project);
  } else studio?.close();
  $('studio').hidden=!open;
  $('studio-button').setAttribute('aria-pressed',String(open));
}
function toggleFocus() {
  const enabled=shell.classList.toggle('focus');
  $('focus-button').setAttribute('aria-pressed',String(enabled));
  if (enabled) {shell.classList.remove('drawer');sidebar.inert=true;workspace.inert=false;}
  else setDrawer(!mobile.matches&&!shell.classList.contains('collapsed'));
}
function openArena() {
  if (!service.ready||service.remaining<2) return notify('Arena needs at least two available free requests.',true);
  const available=service.models.filter(model=>model.available);
  if (new Set(available.map(model=>model.name)).size<2) return notify('Arena needs two distinct available models.',true);
  const options=available.map(model=>[model.id,model.label+' · '+model.name]);
  const first=select(options,available[0].id);
  const second=select(options,available.find(model=>model.name!==available[0].name).id);
  const text=textarea(prompt.value,3200,3);
  text.required=true;
  const cells=element('div',null,{class:'arena-grid'});
  const feedbackLine=element('p','Each comparison uses two free requests.',{role:'status'});
  const fields=form(async()=>{
    if (!text.value.trim()||fields.confirm.disabled) return;
    const models=[first.value,second.value];
    if (available.find(model=>model.id===models[0]).name===available.find(model=>model.id===models[1]).name) {
      feedbackLine.textContent='Choose two different models.';
      return;
    }
    if (service.remaining<2) {feedbackLine.textContent='There is not enough free capacity for another comparison.';return;}
    fields.confirm.disabled=true;
    feedbackLine.textContent='Starting comparison…';
    await library;
    if (!dialog.open || !cells.isConnected) return;
    const comparison=arena={controllers:models.map(()=>new AbortController())};
    cells.replaceChildren();
    const value=text.value.trim();
    let preferred;
    let quotaChanged=false;
    await Promise.all(models.map(async(mode,index)=>{
      const start=performance.now();
      const controller=comparison.controllers[index];
      const card=element('article',null,{class:'arena-result'});
      const title=element('h3',available.find(model=>model.id===mode).name);
      const result=element('div','Waiting…',{class:'message-body plain'});
      const duration=element('p','');
      let answer='';
      const stop=button('Stop',()=>controller.abort());
      const pick=button('Prefer this',()=>{
        preferred?.setAttribute('aria-pressed','false');
        preferred=pick;pick.setAttribute('aria-pressed','true');
        feedbackLine.textContent='Preferred '+title.textContent+'.';
      },{'aria-pressed':'false'});
      pick.disabled=true;
      const copyResult=button('Copy',()=>copy(answer));
      copyResult.disabled=true;
      card.append(title,result,duration,stop,copyResult,pick);
      cells.append(card);
      try {
        await generate(request(mode,[{role:'user',content:value}],value),{
          signal:AbortSignal.any([controller.signal,AbortSignal.timeout(125000)]),
          announce:message=>{feedbackLine.textContent=message;},
          onEvent:event=>{
            if (event.type==='model') title.textContent=event.model+' · '+event.provider;
            if (event.type==='text') {answer+=event.text;result.textContent=answer;}
            if (event.type==='quota') quota(event.value,true);
          }
        });
      } catch (error) {
        duration.textContent=controller.signal.aborted?'Stopped':error.message;
        if (error.status===429) quotaChanged=true;
      } finally {
        stop.disabled=true;
        copyResult.disabled=!answer;
        pick.disabled=!answer;
        duration.textContent+=(duration.textContent?' · ':'')+((performance.now()-start)/1000).toFixed(1)+' s';
        if (answer) renderAnswer(result,answer);
        else result.textContent='No answer received.';
      }
    }));
    if (quotaChanged) void configuration(AbortSignal.timeout(8000)).then(data=>quota(data.remaining)).catch(()=>{});
    if (arena===comparison) {
      feedbackLine.textContent=preferred?'Preferred response selected.':'Comparison complete.';
      fields.confirm.disabled=false;
    }
  },'Compare models');
  fields.append(field('Prompt',text),field('Model A',first),field('Model B',second),feedbackLine,fields.confirm,cells);
  openDialog('AI Arena',fields,'arena-dialog');
}

$('model-button').onclick=()=>{
  const list=$('model-list');
  const open=list.hidden;
  list.hidden=!open;
  $('model-button').setAttribute('aria-expanded',String(open));
  if (!open) return;
  const choices=[{id:'auto',label:'Auto',available:true,description:'Routes requests to an appropriate configured free model.'},...service.models];
  list.replaceChildren(...choices.map(model=>{
    const item=button(null,()=>{
      state.settings.model=model.id;changeSettings();closeModels(true);
    },{'aria-pressed':String(state.settings.model===model.id)});
    item.disabled=!model.available;
    item.append(element('strong',model.label),element('small',(model.provider?model.provider+' · '+model.name+' · ':'')+model.description+(!model.available?' Unavailable.':'')));
    return item;
  }));
  list.querySelector('button:not(:disabled)')?.focus();
};
function closeModels(focus=false) {
  $('model-list').hidden=true;
  $('model-button').setAttribute('aria-expanded','false');
  if (focus) $('model-button').focus();
}
document.addEventListener('click',event=>{if (!event.target.closest('.picker')) closeModels();});
$('model-list').onkeydown=event=>{
  if (!['ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const items=[...$('model-list').querySelectorAll('button:not(:disabled)')];
  const index=items.indexOf(document.activeElement);
  const target=event.key==='Home'?0:event.key==='End'?items.length-1:(index+items.length+(event.key==='ArrowDown'?1:-1))%items.length;
  items[target]?.focus();
};

const Recognizer=window.SpeechRecognition||window.webkitSpeechRecognition;
if (Recognizer) {
  $('voice').hidden=false;
  $('voice').onclick=()=>{
    if (voice) {voice.stop();return;}
    voice=new Recognizer();
    voice.lang=navigator.language||'en-AU';
    voice.onresult=event=>fill((prompt.value+' '+event.results[0][0].transcript).trim());
    voice.onerror=()=>notify('Voice input was unavailable. You can type your message.',true);
    voice.onend=()=>{
      voice=null;
      if (shell.dataset.state==='listening') shell.dataset.state='idle';
      $('voice').setAttribute('aria-pressed','false');
    };
    try {
      voice.start();shell.dataset.state='listening';$('voice').setAttribute('aria-pressed','true');
    } catch {voice=null;notify('Microphone access could not start.',true);}
  };
}

const hour=new Date().getHours();
$('greeting').textContent=hour<6?'Up for one more round?':hour<12?'What shall we play today?':hour<18?'What are we playing today?':'What’s the game plan tonight?';
for (const suggestion of document.querySelectorAll('[data-prompt]')) {
  suggestion.onclick=()=>fill(suggestion.dataset.prompt);
}
if (matchMedia('(pointer:fine)').matches&&!reduced.matches&&(navigator.hardwareConcurrency||4)>=4) {
  let frame;
  workspace.addEventListener('pointermove',event=>{
    if (frame) return;
    frame=requestAnimationFrame(()=>{
      const bounds=workspace.getBoundingClientRect();
      workspace.dataset.spotlight='true';
      workspace.style.setProperty('--pointer-x',event.clientX-bounds.left+'px');
      workspace.style.setProperty('--pointer-y',event.clientY-bounds.top+'px');
      frame=null;
    });
  },{passive:true});
  workspace.addEventListener('pointerleave',()=>{
    if (frame) cancelAnimationFrame(frame);
    frame=null;delete workspace.dataset.spotlight;
  });
  for (const item of document.querySelectorAll('[data-prompt]')) {
    item.addEventListener('pointermove',event=>{
      const bounds=item.getBoundingClientRect();
      item.style.setProperty('--mag-x',((event.clientX-bounds.left)/bounds.width-.5)*7+'px');
      item.style.setProperty('--mag-y',((event.clientY-bounds.top)/bounds.height-.5)*5+'px');
    },{passive:true});
    item.addEventListener('pointerleave',()=>{item.style.removeProperty('--mag-x');item.style.removeProperty('--mag-y');});
  }
}
$('collapse').onclick=()=>{setDrawer(false);$('expand').focus();};
$('expand').onclick=()=>{setDrawer(true);$('new-chat').focus();};
$('scrim').onclick=()=>{setDrawer(false);$('expand').focus();};
$('new-chat').onclick=()=>createChat();
$('history-search').oninput=renderHistory;
$('command').onclick=commands;
$('settings').onclick=settings;
$('persona-button').onclick=personas;
$('studio-button').onclick=()=>toggleStudio();
$('arena-button').onclick=openArena;
$('focus-button').onclick=toggleFocus;
$('stop').onclick=()=>run?.controller.abort();
$('attach').onclick=()=>{$('attach-menu').open=false;$('file').click();};
$('file').onchange=event=>{void attach(event.target.files[0]);event.target.value='';};
$('remove-file').onclick=()=>{attachment=undefined;updateAttachment();};
$('composer').onsubmit=event=>{event.preventDefault();void send(prompt.value.trim());};
prompt.oninput=resizePrompt;
prompt.onkeydown=event=>{
  if (event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!mobile.matches) {
    event.preventDefault();if (!$('send').disabled&&!run) $('composer').requestSubmit();
  }
};
document.addEventListener('keydown',event=>{
  if (event.key==='Escape'&&!$('model-list').hidden) closeModels(true);
  if (event.key==='Escape'&&shell.classList.contains('drawer')&&!dialog.open) {closeDrawer();$('expand').focus();}
  if ((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k') {
    event.preventDefault();
    if (dialog.open) dialog.close();
    else commands();
  }
  if (event.altKey&&event.key.toLowerCase()==='n'&&!dialog.open) {event.preventDefault();createChat();}
});
mobile.addEventListener('change',()=>{
  shell.classList.remove('drawer','collapsed');
  setDrawer(!mobile.matches&&!shell.classList.contains('focus'));
});
setDrawer(!mobile.matches);
applySettings();
render();
void configure();
