import {readFile,writeFile,mkdir,rm,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const archive='site.tar.gz',out='vercel-dist';
const bytes=await readFile(archive);
const entries=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split('\n');
if(entries.some(p=>p.startsWith('/')||p.split('/').includes('..')))throw Error('Invalid archive path');
await rm(out,{recursive:true,force:true});await mkdir(out);
execFileSync('tar',['-xzf',archive,'-C',out,'--no-same-owner']);
for(const item of await readdir(out,{recursive:true,withFileTypes:true})){
 if(!item.isFile())continue;
 const path=join(item.parentPath,item.name);
 if(item.name.startsWith('.')||/\.(?:tar\.gz|mjs|ts|sql)$/.test(item.name)){await rm(path);continue}
 if(/\.(?:html|js|css|json|svg|txt)$/.test(item.name)){
  const source=await readFile(path,'utf8');
  await writeFile(path,source.replaceAll('/pixel/','/'));
 }
}
await writeFile(join(out,'arcade','api-client.js'),"(()=>{async function request(path,options={}){if(!path.startsWith('/api/'))throw Error('Invalid service path.');const headers=new Headers(options.headers||{});headers.set('X-Pixel-Client','pixel-arcade');const response=await fetch('/arcade-api/'+path.slice(5),{...options,headers,credentials:'same-origin',signal:options.signal||AbortSignal.timeout(60000)});const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'The account service is unavailable.'),{status:response.status});if(path==='/api/auth/logout'||data.signedOut)document.dispatchEvent(new CustomEvent('pixel-session-changed'));return data}window.pixelApi={request}})();");
await writeFile(join(out,'ads.txt'),'google.com, pub-8632851454203675, DIRECT, f08c47fec0942fa0\n');
await writeFile(join(out,'robots.txt'),'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /arcade-api/\nDisallow: /github-api/\n');
console.log('Static site prepared. Archive: '+createHash('sha256').update(bytes).digest('hex').slice(0,12));
