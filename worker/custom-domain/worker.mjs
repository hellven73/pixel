import {removedArcadeFile,updateArcadeHTML,updateCompactNav,updateGameLaunch,updateLocalLaunch,updateManual,updateTools} from '../../pixelai-integration.mjs';

const home=new Set(['/','/arcade','/arcade/','/arcade/index.html','/arcade/arcade.html']);

export default {
  async fetch(request,env) {
    const {pathname}=new URL(request.url);
    if (pathname==='/ai' || pathname.startsWith('/ai/')) return env.ASSETS.fetch(request);
    if (!['GET','HEAD'].includes(request.method)) return fetch(request);
    const name=pathname.startsWith('/arcade/')?pathname.slice(8):'';
    if (removedArcadeFile(name)) return new Response('Not found.',{status:404});
    const transform=home.has(pathname)?updateArcadeHTML:({
      'tools.js':updateTools,'hub.js':updateLocalLaunch,'compact-ui.js':updateCompactNav,'manual.html':updateManual,'integration.js':updateGameLaunch
    })[name];
    if (!transform || request.method==='HEAD') return fetch(request);
    const headers=new Headers(request.headers);
    headers.delete('If-None-Match');
    headers.delete('If-Modified-Since');
    const response=await fetch(new Request(request,{headers}),{redirect:'manual'});
    if (response.status!==200) return response;
    const outgoing=new Headers(response.headers);
    for (const header of ['Content-Length','Content-Encoding','ETag','Last-Modified']) outgoing.delete(header);
    outgoing.set('Cache-Control','no-cache');
    return new Response(transform(await response.text()),{status:response.status,headers:outgoing});
  }
};
