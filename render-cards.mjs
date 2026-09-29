/* pre-render plate cards for watched addresses.
   usage: node render-cards.mjs
   reads watchlist.json, renders each plate via api/plate.js handler,
   writes PNGs + registry.json into the site repo's cards/ dir. */
import handler from './api/plate.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SITE_CARDS = '/home/hatch/workspace/stakr/site-repo/cards';
const PUBLIC_BASE = 'https://bozomuse.github.io/stakr-claim/cards';

async function main() {
  const watchlist = JSON.parse(await readFile(join(ROOT, 'watchlist.json'), 'utf8'));
  await mkdir(SITE_CARDS, { recursive: true });
  const registry = {};
  for (const address of watchlist) {
    try {
      const req = new Request('http://localhost/api/plate?address=' + address);
      const res = await handler(req);
      if (!res.ok) {
        console.log('skip', address, 'status', res.status);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const file = address.toLowerCase() + '.png';
      await writeFile(join(SITE_CARDS, file), buf);
      registry[address.toLowerCase()] = {
        png: PUBLIC_BASE + '/' + file,
        renderedAt: new Date().toISOString(),
      };
      console.log('ok', address, buf.length, 'bytes');
    } catch (e) {
      console.log('fail', address, e.message);
    }
  }
  await writeFile(
    join(SITE_CARDS, 'registry.json'),
    JSON.stringify({ updatedAt: new Date().toISOString(), cards: registry }, null, 2)
  );
  console.log('registry:', Object.keys(registry).length, 'cards');
}

main().catch((e) => { console.error(e); process.exit(1); });
