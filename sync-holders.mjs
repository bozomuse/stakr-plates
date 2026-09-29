/* sync the card watchlist to every current STAKR holder.
   scans Transfer events, keeps addresses with non-zero balance,
   merges with the manual watchlist, writes watchlist.json. */
import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const RPCS = [
  'https://mainnet.base.org',
  'https://base.publicnode.com',
  'https://base.llamarpc.com',
];
const STAKR = '0x9319f1a40b284c77fEa9808d1DDD71CC0ec05Ba3';
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const DEPLOY_BLOCK = 51834000;
const SEL_BALANCEOF = '0x70a08231';

async function rpc(method, params) {
  for (const url of RPCS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const j = await r.json();
      if (!j.error) return j.result;
    } catch {}
  }
  throw new Error('all rpc failed: ' + method);
}

async function main() {
  const manual = JSON.parse(await readFile(join(ROOT, 'watchlist.manual.json'), 'utf8').catch(() => '[]'));
  const latest = parseInt(await rpc('eth_blockNumber', []), 16);
  const addrs = new Set(manual.map((a) => a.toLowerCase()));
  for (let f = DEPLOY_BLOCK; f <= latest; f += 1800) {
    const t = Math.min(f + 1799, latest);
    const logs = await rpc('eth_getLogs', [{
      address: STAKR,
      topics: [TRANSFER_TOPIC],
      fromBlock: '0x' + f.toString(16),
      toBlock: '0x' + t.toString(16),
    }]);
    for (const l of logs || []) {
      addrs.add(('0x' + l.topics[1].slice(-40)).toLowerCase());
      addrs.add(('0x' + l.topics[2].slice(-40)).toLowerCase());
    }
  }
  // keep only holders with a balance (plus manual entries, always)
  const manualSet = new Set(manual.map((a) => a.toLowerCase()));
  const holders = [];
  for (const a of addrs) {
    if (manualSet.has(a)) { holders.push(a); continue; }
    try {
      const bal = await rpc('eth_call', [{
        to: STAKR,
        data: SEL_BALANCEOF + a.replace('0x', '').padStart(64, '0'),
      }, 'latest']);
      if (BigInt(bal) > 0n) holders.push(a);
    } catch {}
  }
  holders.sort();
  await writeFile(join(ROOT, 'watchlist.json'), JSON.stringify(holders, null, 1));
  console.log('holders:', holders.length);
}

main().catch((e) => { console.error(e); process.exit(1); });
