import {build} from 'esbuild';
import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {removedArcadeFile,updateArcadeHTML,updateCompactNav,updateGameLaunch,updateLocalLaunch,updateManual,updateTools} from './pixelai-integration.mjs';

const source=new URL('./pixelai/',import.meta.url);
const dependencies=new URL('./node_modules/',import.meta.url);
const staticFiles=['index.html','style.css','mark.svg','app.js','state.js','config.js','transport.js','studio.js'];
let sharedAssets;

async function browserAssets() {
  const files=new Map();
  for (const name of staticFiles) files.set(name,await readFile(new URL(name,source)));
  if (process.env.PIXELAI_ENDPOINT || process.env.PIXELAI_SITE_KEY) {
    const {endpoint,turnstileSiteKey}=await import(new URL('config.js',source));
    files.set('config.js',[
      'export const endpoint = '+JSON.stringify(process.env.PIXELAI_ENDPOINT || endpoint)+';',
      'export const turnstileSiteKey = '+JSON.stringify(process.env.PIXELAI_SITE_KEY || turnstileSiteKey)+';'
    ].join('\n'));
  }
  const {outputFiles}=await build({
    entryPoints:[new URL('rich.js',source).pathname],
    bundle:true, write:false, format:'esm', target:'es2022', minify:true
  });
  files.set('rich.js',outputFiles[0].contents);
  const katex=new URL('katex/dist/',dependencies);
  const css=(await readFile(new URL('katex.min.css',katex),'utf8')).replace(/,url\(fonts\/[^)]+\)(?:\s*format\([^)]+\))?/g,'');
  files.set('katex.css',css);
  for (const name of await readdir(new URL('fonts/',katex))) {
    if (name.endsWith('.woff2')) files.set('fonts/'+name,await readFile(new URL('fonts/'+name,katex)));
  }
  for (const name of ['pdf.mjs','pdf.worker.mjs']) {
    files.set(basename(name,'.mjs')+'.js',await readFile(new URL('pdfjs-dist/legacy/build/'+name.replace('.mjs','.min.mjs'),dependencies)));
  }
  for (const name of ['dompurify','fflate','highlight.js','katex','marked','pdfjs-dist']) {
    files.set('licenses/'+name+'.txt',await readFile(new URL(name+'/LICENSE',dependencies)));
  }
  return files;
}

async function games(arcadeDirectory) {
  const window={};
  const sandbox={window,URL};
  const parse=async path=>JSON.parse(await readFile(path,'utf8'));
  runInNewContext(await readFile(join(arcadeDirectory,'catalog.js'),'utf8'),sandbox,{timeout:150});
  runInNewContext(await readFile(join(arcadeDirectory,'game-policy.js'),'utf8'),sandbox,{timeout:150});
  const originals=await parse(join(arcadeDirectory,'originals.json'));
  const catalogue=await parse(join(arcadeDirectory,'..','catalogue.json'));
  const featured=catalogue.games.filter(game=>game.source==='Featured embeds').map(game=>({
    ...game,id:'portal-'+game.id,cat:game.source,cover:game.image
  }));
  const seen=new Set();
  return [...window.gameCatalog,...originals,...featured].filter(game=>{
    const name=game.name.toLowerCase();
    if (seen.has(name)||!sandbox.pixelGameAllowed(game)) return false;
    seen.add(name);
    return true;
  }).map(({id,name,cat,cover,help})=>({id,name,category:cat,cover:cover||({'hextris-local':'./icons-arcade.svg','cloudmoon-brawl-stars':'./cloudmoon-com-supercell-brawlstars.webp'})[id]||null,help:help||''}));
}

export async function pixelAIAssets(arcadeDirectory) {
  sharedAssets??=browserAssets();
  return new Map([...await sharedAssets,['games.json',JSON.stringify(await games(arcadeDirectory))]]);
}

export async function writePixelAI(output,arcadeDirectory) {
  const assets=await pixelAIAssets(arcadeDirectory);
  const directory=join(output,'ai');
  await Promise.all(['fonts','licenses'].map(name=>mkdir(join(directory,name),{recursive:true})));
  await Promise.all(Array.from(assets,([name,data])=>writeFile(join(directory,name),data)));
}


export async function applyPixelAI(output) {
  const arcadeDirectory=join(output,'arcade');
  const update=async(name,transform)=>{
    const path=join(output,name);
    const before=await readFile(path,'utf8');
    const after=transform(before);
    if (before===after) throw Error('PixelAI integration marker missing in '+name);
    await writeFile(path,after);
  };
  await Promise.all([
    writePixelAI(output,arcadeDirectory),
    update('index.html',updateArcadeHTML),
    update('arcade/index.html',updateArcadeHTML),
    update('arcade/arcade.html',updateArcadeHTML),
    update('arcade/tools.js',updateTools),
    update('arcade/hub.js',updateLocalLaunch),
    update('arcade/compact-ui.js',updateCompactNav),
    update('arcade/manual.html',updateManual),
    update('arcade/integration.js',updateGameLaunch)
  ]);
  await Promise.all((await readdir(arcadeDirectory)).filter(removedArcadeFile).map(name=>rm(join(arcadeDirectory,name))));
}

if (process.argv[1]===new URL(import.meta.url).pathname && process.argv[2]) {
  if (process.argv[2]==='--edge') await writePixelAI('pixelai-edge-dist','vercel-dist/arcade');
  else await applyPixelAI(process.argv[2]);
}
