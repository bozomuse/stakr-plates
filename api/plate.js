/* stakr plate card renderer — GET /api/plate?address=0x...
   live onchain plate PNG (1200x675), mirrors claim-site/share-card.js. */
import { ImageResponse } from '@vercel/og';
import { plateData } from '../lib/chain.js';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PAPER = '#FAF3E7';
const INK = '#1E1A16';
const MUTED = '#6B5F52';
const KETCHUP = '#C8342A';
const MUSTARD = '#E8A020';
const LINE = '#E3D5BE';

let fontCache = null;
async function loadFonts() {
  if (fontCache) return fontCache;
  const files = [
    ['Alfa Slab One', 400, 'alfa-slab-one.ttf'],
    ['Space Mono', 400, 'space-mono-400.ttf'],
    ['Space Mono', 700, 'space-mono-700.ttf'],
    ['Inter', 400, 'inter-400.ttf'],
    ['Inter', 500, 'inter-500.ttf'],
  ];
  const fonts = [];
  for (const [name, weight, file] of files) {
    const data = await readFile(join(ROOT, 'fonts', file));
    fonts.push({
      name, weight, style: 'normal',
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    });
  }
  fontCache = fonts;
  return fonts;
}

const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const D = (style, children) => ({ type: 'div', props: { style, children } });
const mono = (size, weight, color) => ({
  fontFamily: 'Space Mono', fontSize: size, fontWeight: weight, color,
});

function heroSize(text) {
  const s = Math.min(92, Math.floor(1088 / (text.length * 0.6)));
  return Math.max(s, 28);
}

function errorCard(msg, fonts) {
  return new ImageResponse(
    D(
      {
        width: 1200, height: 675, background: PAPER, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: '0 80px',
      },
      D({ fontFamily: 'Inter', fontSize: 40, color: MUTED, textAlign: 'center' }, msg)
    ),
    { width: 1200, height: 675, fonts }
  );
}

export default async function handler(req) {
  const url = new URL(req.url);
  const address = url.searchParams.get('address') || '';
  const fonts = await loadFonts().catch(() => []);

  if (!isAddr(address)) {
    return errorCard('that plate doesn\u2019t exist — the grill needs a 0x address.', fonts);
  }

  let d;
  try {
    d = await plateData(address);
  } catch (e) {
    return errorCard('the chain didn\u2019t pick up — try again in a bit.', fonts);
  }

  let hero, sub;
  if (d.claimable > 0) {
    hero = d.claimable.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' bnkr';
    sub = 'ready to claim — come get it';
  } else {
    hero = d.myStakr + ' stakr';
    sub = 'on my plate — first cookout soon';
  }
  const crown = d.masterName
    ? d.masterName + ' · ' + d.masterBurned + ' burned'
    : 'up for grabs · 1M to enter';

  const el = D(
    {
      width: 1200, height: 675, background: PAPER, display: 'flex',
      flexDirection: 'column', fontFamily: 'Inter',
    },
    [
      D(
        {
          background: KETCHUP, height: 128, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '0 56px', flexShrink: 0,
        },
        [
          D({ fontFamily: 'Alfa Slab One', fontSize: 52, color: PAPER }, 'stakr & stakr'),
          D({ fontSize: 30, fontWeight: 500, color: PAPER }, 'the cookout'),
        ]
      ),
      D({ background: MUSTARD, height: 10, flexShrink: 0 }),
      D({ display: 'flex', flexDirection: 'column', padding: '20px 56px 0' }, [
        D(
          { fontFamily: 'Alfa Slab One', fontSize: 100, color: INK, lineHeight: 1 },
          'my plate'
        ),
        D({ ...mono(24, 400, MUTED), marginTop: 4 }, d.address),
        D(
          { ...mono(heroSize(hero), 700, KETCHUP), marginTop: 14, lineHeight: 1 },
          hero
        ),
        D({ fontSize: 28, color: MUTED, marginTop: 4 }, sub),
        D({ background: LINE, height: 3, marginTop: 20 }),
        D({ display: 'flex', marginTop: 16 }, [
          D({ display: 'flex', flexDirection: 'column', width: 560 }, [
            D({ fontSize: 24, color: MUTED }, 'the cooler'),
            D(mono(30, 700, INK), d.cooler + ' bnkr'),
            D({ fontSize: 24, color: MUTED, marginTop: 10 }, 'my cut'),
            D(mono(30, 700, KETCHUP), '~' + d.cut + ' bnkr'),
          ]),
          D({ display: 'flex', flexDirection: 'column' }, [
            D({ fontSize: 24, color: MUTED }, 'grill master'),
            D(mono(28, 700, INK), crown),
          ]),
        ]),
      ]),
      D(
        { marginTop: 'auto', padding: '0 56px 30px', fontSize: 22, color: MUTED },
        'hold stakr. earn bnkr · bozomuse.github.io/stakr-claim'
      ),
    ]
  );

  return new ImageResponse(el, {
    width: 1200,
    height: 675,
    fonts,
    headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
  });
}
