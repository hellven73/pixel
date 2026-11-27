import {Marked} from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import cpp from 'highlight.js/lib/languages/cpp';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import {zipSync,strToU8} from 'fflate';

for (const [language,syntax] of Object.entries({javascript,css,xml,python,cpp,json,bash})) hljs.registerLanguage(language,syntax);

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

export function markdown(target,text,copy,preview) {
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
    const language=[...code.classList].find(item=>item.startsWith('language-'))?.slice(9).toLowerCase().replace(/^(c\+\+|cxx)$/,'cpp').replace(/^py$/,'python');
    if (language && hljs.getLanguage(language)) {
      code.innerHTML=hljs.highlight(source,{language,ignoreIllegals:true}).value;
    }
    const button=Object.assign(document.createElement('button'),{type:'button',textContent:'Copy code'});
    button.onclick=()=>copy(source);
    const actions=document.createElement('div');
    actions.className='code-actions';
    actions.append(button);
    if (preview&&['python','cpp'].includes(language)) {
      const run=Object.assign(document.createElement('button'),{type:'button',textContent:'Preview'});
      run.onclick=()=>preview(language,source);
      actions.prepend(run);
    }
    code.parentElement.prepend(actions);
  }
}

export function highlight(target,text,language) {
  target.innerHTML=hljs.highlight(text,{language,ignoreIllegals:true}).value;
}

export function projectZip(files) {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name,text])=>[name,strToU8(text)])));
}


export function illustration(text) {
  const full=text.match(/<svg\b[\s\S]*?<\/svg>/i)?.[0];
  const fragment=text.match(/```(?:svg|xml|html)?[ \t]*\n([\s\S]*?)```/i)?.[1]||text;
  const shapes=fragment.match(/<(?:rect|circle|ellipse|path|polygon|polyline|line)\b[^<>]*\/?>(?:<\/(?:rect|circle|ellipse|path|polygon|polyline|line)>)?/gi);
  if (!full&&!shapes?.length) throw Error('The model did not return an SVG. Try a simpler illustration prompt.');
  const source=full||'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'+shapes.join('')+'</svg>';
  const clean=DOMPurify.sanitize(source,{
    ALLOWED_TAGS:['svg','g','path','rect','circle','ellipse','line','polygon','polyline','text','tspan','title','desc','defs','linearGradient','radialGradient','stop'],
    ALLOWED_ATTR:['xmlns','viewBox','width','height','id','x','y','x1','x2','y1','y2','cx','cy','r','rx','ry','d','points','transform','fill','fill-rule','fill-opacity','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-opacity','opacity','font-family','font-size','font-weight','text-anchor','dominant-baseline','offset','stop-color','stop-opacity','gradientUnits','gradientTransform','fx','fy'],
    ALLOW_DATA_ATTR:false
  });
  const svg=new DOMParser().parseFromString(clean,'image/svg+xml').documentElement;
  if (svg.localName!=='svg'||!svg.querySelector('rect,circle,ellipse,path,line,polygon,polyline,text')) throw Error('The model returned an invalid SVG.');
  svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
  if (!svg.hasAttribute('viewBox')) svg.setAttribute('viewBox','0 0 512 512');
  svg.setAttribute('width','512');
  svg.setAttribute('height','512');
  for (const node of [svg,...svg.querySelectorAll('*')]) {
    for (const attr of [...node.attributes]) {
      if (['fill','stroke','stop-color'].includes(attr.name)) {
        if (!CSS.supports('color',attr.value)&&attr.value!=='none'&&!/^url\(#[\w-]+\)$/.test(attr.value)) node.removeAttribute(attr.name);
      } else if (/url\(/i.test(attr.value)) node.removeAttribute(attr.name);
    }
  }
  return new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'});
}
