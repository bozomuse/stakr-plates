/* stakr plate card data — server-side mirror of claim-site/share-card.js.
   same contracts, same math, same exclusion list. runs on node. */

const RPCS = [
  'https://mainnet.base.org',
  'https://base.publicnode.com',
  'https://base.llamarpc.com',
  'https://1rpc.io/base',
  'https://base.meowrpc.com',
];
let rpcIdx = 0;

const STAKR = '0x9319f1a40b284c77fEa9808d1DDD71CC0ec05Ba3';
const BNKR = '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b';
const DISTRIBUTOR = '0x7b896a892C052C5243Dde20b54a4654e51A3A952';
const DEAD = '0x000000000000000000000000000000000000dEaD';

const SEL_BALANCEOF = '0x70a08231';
const SEL_TOTALSUPPLY = '0x18160ddd';
const SEL_HASCLAIMED = '0x873f6f9e';
const SEL_EPOCHS = '0xc6b61e4c';

const EXCLUDED_PLATES = [
  '0x000000000000000000000000000000000000dEaD',
  '0x72b30a9DfEEdC67e8a554e16bFCA3b57600f7258', // keeper
  '0x498581fF718922c3f8e6A244956aF099B2652b2b', // pool-side holder
  '0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544', // fee hook
  '0xbd771a0071ca2833604257eef6d2de5d676d33e1', // bozo bankr wallet
  '0xe7aD68a354403660b4BEB99068580431D5c72602', // work/ceremonial wallet
];

const CARD_NAMES = {
  '0x891691ce817db5d09fc5bbbea6ae012cfe829aef': 'kyle',
  '0xda641d4ff3a5ea3c8b5265db8701622a68998903': 'kyle',
  '0xbd771a0071ca2833604257eef6d2de5d676d33e1': 'bozo',
};

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const DEAD_PADDED =
  '0x000000000000000000000000' + DEAD.slice(2).toLowerCase();
const BURN_FROM_BLOCK = 51834000;
const LOG_CHUNK = 1800;
const PROOFS_BASE = 'https://bozomuse.github.io/stakr-claim/proofs/';

const u256 = (n) => BigInt(n).toString(16).padStart(64, '0');
const encAddr = (a) => a.toLowerCase().replace('0x', '').padStart(64, '0');

async function rpcCall(method, params, tries = 3) {
  let lastErr = null;
  for (let t = 0; t < tries; t++) {
    for (let i = 0; i < RPCS.length; i++) {
      const url = RPCS[(rpcIdx + i) % RPCS.length];
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
        if (!res.ok) throw new Error('rpc http ' + res.status);
        const j = await res.json();
        if (j.error) throw new Error(j.error.message || method + ' failed');
        rpcIdx = (rpcIdx + i) % RPCS.length;
        return j.result;
      } catch (e) {
        lastErr = e;
      }
    }
    await new Promise((r) => setTimeout(r, 400 * (t + 1)));
  }
  throw lastErr || new Error(method + ' failed on all RPCs');
}

const balanceOf = (token, addr) =>
  rpcCall('eth_call', [{ to: token, data: SEL_BALANCEOF + encAddr(addr) }, 'latest']).then(
    (r) => BigInt(r)
  );

function isExcludedPlate(addr) {
  const low = addr.toLowerCase();
  return (
    low === DISTRIBUTOR.toLowerCase() ||
    EXCLUDED_PLATES.some((a) => a.toLowerCase() === low)
  );
}

async function coolerCut(addr, myStakr, cooler) {
  if (myStakr <= 0n || isExcludedPlate(addr)) return 0n;
  const supply = BigInt(await rpcCall('eth_call', [{ to: STAKR, data: SEL_TOTALSUPPLY }, 'latest']));
  let eligible = supply;
  for (const a of [DISTRIBUTOR, ...EXCLUDED_PLATES]) {
    eligible -= await balanceOf(STAKR, a);
  }
  if (eligible <= 0n) return 0n;
  return (myStakr * cooler) / eligible;
}

/* claimable: same rules as the site claim rows — in proofs, not claimed
   onchain, window open. no production epochs yet, so usually 0. */
async function claimableFor(address) {
  try {
    const idxRes = await fetch(PROOFS_BASE + 'epochs.json');
    if (!idxRes.ok) return 0;
    const idx = await idxRes.json();
    const nowSec = Math.floor(Date.now() / 1000);
    let total = 0n;
    for (const e of idx.epochs || []) {
      const r = await fetch(PROOFS_BASE + e.file);
      if (!r.ok) continue;
      const data = await r.json();
      const claim = (data.claims || {})[address] ||
        (data.claims || {})[address.toLowerCase()];
      if (!claim) continue;
      const amount = BigInt(claim.amount);
      const claimed = BigInt(
        await rpcCall('eth_call', [{
          to: DISTRIBUTOR,
          data: SEL_HASCLAIMED + u256(data.epochId ?? e.epochId ?? 0) + encAddr(address),
        }, 'latest'])
      );
      if (claimed === 1n) continue;
      const ep = await rpcCall('eth_call', [{
        to: DISTRIBUTOR,
        data: SEL_EPOCHS + u256(data.epochId ?? e.epochId ?? 0),
      }, 'latest']).catch(() => null);
      if (ep) {
        const words = ep.replace('0x', '').match(/.{1,64}/g) || [];
        if (words.length >= 6) {
          const start = Number(BigInt('0x' + words[3]));
          const deadline = Number(BigInt('0x' + words[4]));
          if (start > nowSec) continue;
          if (deadline > 0 && nowSec > deadline) continue;
        }
      }
      total += amount;
    }
    return Number(total) / 1e18;
  } catch {
    return 0;
  }
}

/* grill master: biggest burner to dead (kicker kicks + direct burns,
   deduped by tx hash). cached in-memory — burns are rare. */
let burnCache = null;
let burnCacheAt = 0;
const BURN_TTL_MS = 10 * 60 * 1000;

async function grillMaster() {
  const now = Date.now();
  if (burnCache && now - burnCacheAt < BURN_TTL_MS) return burnCache;
  const latest = parseInt(await rpcCall('eth_blockNumber', []), 16);
  const seen = new Set();
  const totals = new Map();
  for (let from = BURN_FROM_BLOCK; from <= latest; from += LOG_CHUNK) {
    const to = Math.min(from + LOG_CHUNK - 1, latest);
    let logs = null;
    for (let t = 0; t < 3 && !logs; t++) {
      try {
        logs = await rpcCall('eth_getLogs', [{
          address: STAKR,
          topics: [TRANSFER_TOPIC, null, DEAD_PADDED],
          fromBlock: '0x' + from.toString(16),
          toBlock: '0x' + to.toString(16),
        }]);
      } catch {
        await new Promise((r) => setTimeout(r, 800 * (t + 1)));
      }
    }
    if (!logs) continue;
    for (const log of logs) {
      const tx = (log.transactionHash || '').toLowerCase();
      if (!tx || seen.has(tx)) continue;
      seen.add(tx);
      const burner = ('0x' + log.topics[1].slice(-40)).toLowerCase();
      const amount = BigInt(log.data);
      totals.set(burner, (totals.get(burner) || 0n) + amount);
    }
  }
  let best = null;
  for (const [addr, total] of totals) {
    if (!best || total > best.total) best = { addr, total };
  }
  burnCache = best;
  burnCacheAt = now;
  return best;
}

function cardName(addr) {
  if (!addr) return null;
  return CARD_NAMES[addr.toLowerCase()] || addr.slice(0, 6) + '…' + addr.slice(-4);
}

const fmtWhole = (wei) =>
  (wei / 1000000000000000000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

async function plateData(address) {
  const [cooler, myStakr, claimable, master] = await Promise.all([
    balanceOf(BNKR, DISTRIBUTOR),
    balanceOf(STAKR, address),
    claimableFor(address),
    grillMaster().catch(() => null),
  ]);
  let cut = 0n;
  try {
    cut = await coolerCut(address, myStakr, cooler);
  } catch { /* cut stays 0 */ }
  return {
    address,
    cooler: fmtWhole(cooler),
    myStakr: fmtWhole(myStakr),
    claimable,
    cut: fmtWhole(cut),
    masterName: cardName(master && master.addr),
    masterBurned: master ? fmtWhole(master.total) : null,
  };
}

export { plateData, isExcludedPlate };
