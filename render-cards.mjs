/* pre-render plate cards for watched addresses.
   usage: node render-cards.mjs
   reads watchlist.json, renders each plate, writes PNGs + registry.json
   (with headline numbers, so the bankr skill can quote them without
   recomputing) into the site repo's cards/ dir. */
import { renderPlate } from './api/plate.js';
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
      const { png, data } = await renderPlate(address);
      const file = address.toLowerCase() + '.png';
      await writeFile(join(SITE_CARDS, file), png);
      const entry = {
        png: PUBLIC_BASE + '/' + file,
        renderedAt: new Date().toISOString(),
      };
      if (data) {
        entry.stakr = data.myStakr;
        entry.cooler = data.cooler;
        entry.cut = data.cut;
        entry.claimable = data.claimable;
        entry.grillMaster = data.masterName;
        entry.grillMasterBurned = data.masterBurned;
      }
      registry[address.toLowerCase()] = entry;
      console.log('ok', address, png.length, 'bytes');
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
