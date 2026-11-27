import {Marked} from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import {zipSync,strToU8} from 'fflate';

for (const [language,syntax] of Object.entries({javascript,css,xml,python,json,bash})) hljs.registerLanguage(language,syntax);

const parser=new Marked({
  gfm:true,
  extensions:[{
    name:'equation',level:'inline',
    start:text=>text.search(/\$\$|\\\(|\\\[|\$(?=\S)/),
    tokenizer(text){
      const match=text.match(/^\$\$([\s\S]+?)\$\$|^\\\[([\s\S]+?)\\\]|^\\\(([^\n]+?)\\\)|^\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?![\w$])/);
      if (!match) return;
      return {type:'equation',raw:match[0],text:match.slice(1).find(Boolean),display:Boolean(match[1]||match[2])};
    },
    renderer(token){
      const element=document.createElement(token.display?'div':'span');
      element.className='equation-source';
      element.textContent=token.text;
      return element.outerHTML;
    }
  }]
});

function isLinkAllowed(href) {
  try {
    const url=new URL(href,location.href);
    return ['https:','http:'].includes(url.protocol);
  } catch { return false; }
}

export function markdown(target,text,copy) {
  const fragment=DOMPurify.sanitize(parser.parse(text),{
    RETURN_DOM_FRAGMENT:true,USE_PROFILES:{html:true},
    FORBID_TAGS:['img','video','audio','form','input','button','textarea','select','style','iframe','dialog','details','summary'],
    FORBID_ATTR:['style','id','name','target','srcset','ping','formaction'],
    ALLOW_DATA_ATTR:false
  });
  target.replaceChildren(fragment);
  for (const anchor of target.querySelectorAll('a')) {
    if (!anchor.hasAttribute('href')||!isLinkAllowed(anchor.getAttribute('href'))) {
      anchor.replaceWith(document.createTextNode(anchor.textContent));
      continue;
    }
    anchor.target='_blank';
    anchor.rel='noopener noreferrer';
  }
  for (const math of target.querySelectorAll('.equation-source')) {
    katex.render(math.textContent,math,{displayMode:math.tagName==='DIV',throwOnError:false,trust:false,maxSize:8,maxExpand:200});
  }
  for (const code of target.querySelectorAll('pre>code')) {
    const source=code.textContent;
    const language=[...code.classList].find(item=>item.startsWith('language-'))?.slice(9);
    if (language && hljs.getLanguage(language)) {
      code.innerHTML=hljs.highlight(source,{language,ignoreIllegals:true}).value;
    }
    const button=Object.assign(document.createElement('button'),{type:'button',textContent:'Copy code'});
    button.onclick=()=>copy(source);
    code.parentElement.prepend(button);
  }
}

export function highlight(target,text,language) {
  target.innerHTML=hljs.highlight(text,{language,ignoreIllegals:true}).value;
}

export function projectZip(files) {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name,text])=>[name,strToU8(text)])));
}
