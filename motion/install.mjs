import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const assets = ['home-motion.css', 'home-motion.js'];
const stylesheet = '<link rel="stylesheet" href="home-motion.css?v=1">';
const script = '<script type="module" src="home-motion.js?v=1"></script>';

export async function installHomeMotion(directory) {
  const pages = ['index.html', 'arcade/index.html'];
  for (const page of pages) {
    const path = resolve(directory, page);
    const html = await readFile(path, 'utf8');
    if (!html.includes('id="home-page"') || !html.includes('</head>') || !html.includes('</body>')) {
      throw new Error(`Missing Arcade homepage in ${page}`);
    }
    if (!html.includes(script)) {
      await writeFile(path, html
        .replace('</head>', `${stylesheet}</head>`)
        .replace('</body>', `${script}</body>`));
    }
  }
  await Promise.all(assets.map(name => copyFile(new URL(name, import.meta.url), resolve(directory, 'arcade', name))));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (!process.argv[2]) throw new Error('Pass the directory containing the built Arcade site.');
  await installHomeMotion(process.argv[2]);
}
