
class Component extends DCLogic {
  state = { selfOpen: false, depChain: 'Ethereum', reflect: false, fundOpen: false, fundCcy: 'USD', invPick: null, investAmt: '25000', tuOpen: false, topupSrc: 'vault', topupAmt: '2000', sendOpen: false, sendAmt: '5000', sendIban: 'DE89 3704 0044 0532 0130 00', sendName: 'Marcus Feldt', lane: 'pre', search: '', fStatus: 'all', fTier: 'all', fQual: 'all', fSort: 'age', connecting: null, svcPaid: false, docsUp: 0, state0: true, cits: [{ code: 'DE', name: 'Germany' }], ress: [{ code: 'DE', name: 'Germany', years: '2016–now' }], mode: 'resident', ascreen: 'queue', openQ: 'CW-2026-0409', decisions: {}, tier: 1, members: 3, screen: 'overview', alloc: {}, step: 0, done: false, kyc: false, linked: { mm: false, cb: false, lg: false, btc: false }, vault: { usdc: false, eth: false, usdy: false, btc: false }, paid: false, reviewed: false, dir: 'b2c', amt: '25000', swapped: false, card: false, slash: false, vote: null, voted: false };

  usd(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

  renderVals() {
    const s = this.state;
    const dash = s.done;
    const titles = [
      ['Create account', 'Email + passkey · Safe on Ethereum'],
      ['Profile & household', 'Name, citizenship, birth date, family'],
      ['Proof of wealth', 'Link wallets · read-only'],
      ['Pay pre-approval fee', 'Instant pre-approval']
    ];
    const admin = s.mode === 'admin';
    const COUNTRIES = [
      { code: 'NL', name: 'Netherlands' }, { code: 'DE', name: 'Germany' }, { code: 'US', name: 'United States' },
      { code: 'GB', name: 'United Kingdom' }, { code: 'CH', name: 'Switzerland' }, { code: 'CA', name: 'Canada' },
      { code: 'AE', name: 'United Arab Emirates' }, { code: 'SG', name: 'Singapore' }, { code: 'BR', name: 'Brazil' },
      { code: 'VE', name: 'Venezuela' }, { code: 'CO', name: 'Colombia' }, { code: 'SR', name: 'Suriname' },
      { code: 'ZA', name: 'South Africa' }, { code: 'PT', name: 'Portugal' }
    ];
    const TIERS = [{ name: '3-year', min: 280000 }, { name: '5-year', min: 425000 }, { name: 'Indefinite', min: 850000 }];
    const tierSel = TIERS[s.tier];
    const allMembers = [
      { name: 'Lena Feldt', rel: 'Spouse', dob: '22 Jul 1985', cit: 'NL', ini: 'LF' },
      { name: 'Emil Feldt', rel: 'Son', dob: '03 May 2015', cit: 'DE / NL', ini: 'EF' },
      { name: 'Sofia Feldt', rel: 'Daughter', dob: '19 Nov 2018', cit: 'DE / NL', ini: 'SF' },
      { name: 'Ingrid Feldt', rel: 'Dependent parent', dob: '02 Feb 1954', cit: 'DE', ini: 'IF' }
    ];
    const household = allMembers.slice(0, s.members);
    const feeUsdcN = Math.round((500 + 100 * s.members) / 1.79);
    const steps = titles.map((t, i) => {
      const cur = s.step === i, past = i < s.step || dash;
      return { title: t[0], sub: t[1], go: () => this.setState({ step: i }), bg: cur ? '#EAF2FC' : 'transparent', fg: cur ? '#0063B5' : (past ? '#101828' : '#667085'), mark: past ? '✓' : String(i + 1), dotBg: past ? '#0063B5' : (cur ? '#fff' : '#fff'), dotFg: past ? '#fff' : (cur ? '#0063B5' : '#667085'), dotBorder: past || cur ? '#0063B5' : '#D9DFE7' };
    });
    const provs = [
      { k: 'mm', name: 'Browser extension', sub: 'MetaMask, Rabby · EVM', ico: 'EXT', color: '#E8831D', val: 49575, assets: '25 ETH across 5 chains', chain: 'EVM · 5 chains', addr: '0x71C9…2fA1', evm: true, chains: [{ n: 'Ethereum', c: '#627EEA', a: '14.20 ETH', v: 28150 }, { n: 'Base', c: '#0052FF', a: '6.10 ETH', v: 12093 }, { n: 'Arbitrum', c: '#2D374B', a: '3.40 ETH', v: 6740 }, { n: 'Optimism', c: '#FF0420', a: '1.05 ETH', v: 2082 }, { n: 'Celo', c: '#FCFF52', a: '0.25 ETH', v: 510 }] },
      { k: 'cb', name: 'WalletConnect', sub: 'Scan with a mobile wallet', ico: 'WC', color: '#3B99FC', val: 150000, assets: '150,000 USDC across 5 chains', chain: 'EVM · 5 chains', addr: '0x3aD0…77b2', evm: true, chains: [{ n: 'Ethereum', c: '#627EEA', a: '84,200 USDC', v: 84200 }, { n: 'Base', c: '#0052FF', a: '41,500 USDC', v: 41500 }, { n: 'Arbitrum', c: '#2D374B', a: '18,800 USDC', v: 18800 }, { n: 'Optimism', c: '#FF0420', a: '4,100 USDC', v: 4100 }, { n: 'Celo', c: '#FCFF52', a: '1,400 USDC', v: 1400 }] },
      { k: 'lg', name: 'Hardware wallet', sub: 'Ledger, Trezor · EVM', ico: 'HW', color: '#101828', val: 50000, assets: '48,900 USDY across 2 chains', chain: 'EVM · 2 chains', addr: '0x9E4b…c113', evm: true, chains: [{ n: 'Ethereum', c: '#627EEA', a: '44,900 USDY', v: 45900 }, { n: 'Base', c: '#0052FF', a: '4,000 USDY', v: 4100 }, { n: 'Arbitrum', c: '#2D374B', a: '—', v: 0 }, { n: 'Optimism', c: '#FF0420', a: '—', v: 0 }, { n: 'Celo', c: '#FCFF52', a: '—', v: 0 }] },
      { k: 'btc', name: 'Bitcoin', sub: 'Watch-only xpub · Sparrow, Ledger', ico: 'BTC', color: '#F7931A', val: 203216, assets: '3.2 BTC', chain: 'Bitcoin', addr: 'bc1q…8x2v', evm: false, chains: [] }
    ];
    const providers = provs.map(p => Object.assign({}, p, { linked: !!s.linked[p.k], unlinked: !s.linked[p.k], link: () => this.setState({ connecting: p }) }));
    const linkedWallets = provs.filter(p => s.linked[p.k]).map(p => Object.assign({}, p, { valFmt: this.usd(p.val), isEvm: !!p.evm, chainRows: (p.chains || []).filter(c => c.v > 0).map(c => Object.assign({}, c, { vFmt: this.usd(c.v), w: (c.v / p.val * 100).toFixed(1) + '%' })) }));
    const linkedTotal = linkedWallets.reduce((a, w) => a + w.val, 0);
    const allocTotal = Object.keys(s.alloc).reduce((a, k) => a + s.alloc[k], 0);
    const usdcVal = Math.max(0, 150000 - allocTotal);
    const deps = [
      { k: 'usdc', name: 'USDC', from: 'WalletConnect', sym: 'USDC', color: '#2775CA', amt: usdcVal.toLocaleString('en-US'), val: usdcVal, chain: 'Ethereum', chainColor: '#627EEA' },
      { k: 'eth', name: 'Ethereum', from: 'MetaMask', sym: 'ETH', color: '#627EEA', amt: '25.00', val: 49575, chain: 'Base', chainColor: '#0052FF' },
      { k: 'usdy', name: 'USDY · tokenized treasuries', from: 'Ledger', sym: 'USDY', color: '#0063B5', amt: '48,900', val: 50000, chain: 'Arbitrum', chainColor: '#2D374B' },
      { k: 'btc', name: 'Bitcoin (wrapped via GOS)', from: 'Bitcoin xpub', sym: 'BTC', color: '#F7931A', amt: '3.2000', val: 203216, chain: 'Ethereum', chainColor: '#627EEA' }
    ];
    const deposits = deps.map(d => Object.assign({}, d, { valFmt: this.usd(d.val), in: !!s.vault[d.k], out: !s.vault[d.k], add: () => this.setState(st => { const v = Object.assign({}, st.vault); v[d.k] = true; return { vault: v }; }) }));
    const vaultRows = deps.filter(d => s.vault[d.k] && d.val > 0).map(d => Object.assign({}, d, { valFmt: this.usd(d.val) }, d.k === 'usdc' && s.reflect ? { name: 'USDT+ · Reflect USD vault', sym: 'USDT+', from: 'Converted from USDC', color: '#0063B5' } : {}));
    const qual = vaultRows.reduce((a, d) => a + d.val, 0) + (s.vault.usdc ? allocTotal : 0);
    const tier = qual >= 850000 ? 'Indefinite tier' : qual >= 425000 ? '5-year tier reached' : qual >= 280000 ? '3-year tier reached' : 'Below 3-year tier — ' + this.usd(280000 - qual) + ' to go';
    const tierColor = qual >= 280000 ? '#1B7F5A' : '#B7791F';
    const inReview = dash && !s.reviewed;
    const stageDefs0 = [
      ['Profile, household & proof of wealth', linkedWallets.length + ' wallets · ' + this.usd(linkedTotal) + ' · provenance clean', 'Completed'],
      ['Fee paid · account pre-approved', feeUsdcN + ' USDC · kade.fee.v1', 'Completed'],
      ['Identity verified', s.kyc ? 'Self proof · kade.kyc.v1' : 'Verify with Self · do this in Residency', s.kyc ? 'Completed' : 'In progress'],
      ['Qualified holdings funded', qual >= tierSel.min ? this.usd(qual) + ' · meets ' + tierSel.name + ' tier' : this.usd(qual) + ' · ' + this.usd(tierSel.min - qual) + ' to ' + tierSel.name + ' tier', qual >= tierSel.min ? 'Completed' : 'In progress'],
      ['Intake review', s.reviewed ? 'Cleared · no issues found' : 'Admin review · account pre-approved meanwhile', s.reviewed ? 'Completed' : 'In progress'],
      ['Start Residency · 2,000 USDC service fee', s.svcPaid ? 'Paid · package submitted' : 'Unlocks when identity, containers, documents and review are ready', s.svcPaid ? 'Completed' : 'Queued']
    ];
    const stageDefs = stageDefs0;
    const stages = stageDefs.map((d, i) => { const st = d[2]; const done = st === 'Completed'; const act = st === 'In progress'; return { n: done ? '✓' : String(i + 1), title: d[0], meta: d[1], status: st, color: done ? '#1B7F5A' : act ? '#B7791F' : '#667085', nBg: done ? '#0063B5' : act ? '#FDF6E7' : '#F2F4F7', nFg: done ? '#fff' : act ? '#B7791F' : '#667085', op: done || act ? 1 : .6 }; });
    const receipts = [
      { what: 'Identity attestation · Self', meta: 'kade.kyc.v1 · 15 Sep 2026', uid: '0x9c2e…41af' },
      { what: 'Fee receipt · 447 USDC', meta: 'kade.fee.v1 · tx 0x8b1d…e77a', uid: '0x41c9…02be' },
      { what: 'Application submitted', meta: 'kade.application.v1 · CW-2026-0409', uid: '0x77aa…19c3' }
    ];
    if (s.reviewed) receipts.push({ what: 'Intake review cleared', meta: 'kade.review.v1 · reviewer key', uid: '0x1d0f…9e44' });
    if (s.svcPaid) receipts.push({ what: 'Residency service fee · 2,000 USDC', meta: 'kade.fee.v1 · tx 0x3e9a…c410', uid: '0x6b2d…88f1' });
    // GOS swap
    const b2c = s.dir === 'b2c';
    const amtN = Number(String(s.amt).replace(/[^0-9.]/g, '')) || 0;
    const out = b2c ? amtN * 1.087 * 0.995 : amtN * 1.79 * 0.995;
    const c2bLocked = !b2c && inReview;
    // vote
    const base = [56, 38, 12];
    const voted = s.voted && s.vote !== null;
    const tallies = base.map((b, i) => b + (voted && s.vote === i ? 1 : 0));
    const tot = tallies.reduce((a, b) => a + b, 0);
    const labels = ['Housing supply — co-finance 120 affordable units', 'SME credit — first-loss capital for local lenders', 'Split 50 / 50'];
    const choices = labels.map((l, i) => ({ label: l, pct: Math.round(tallies[i] / tot * 100) + '%', border: s.vote === i ? '#0A7CFF' : '#EAEDF1', bar: s.vote === i ? '#0A7CFF' : '#0063B5', pick: () => { if (!s.voted) this.setState({ vote: i }); } }));
    // ---- residency (Start Residency flow)
    const idReady = s.kyc, contReady = qual >= tierSel.min, revReady = s.reviewed;
    const docList = [
      { name: 'Passport · Marcus', meta: 'DE · expires Mar 2031', have: true },
      { name: 'Passports · household', meta: household.length + ' documents', have: true },
      { name: 'Marriage & birth certificates', meta: 'apostilled', have: true },
      { name: 'Police clearances', meta: s.ress.map(r => r.code).join(', ') + ' · one per residence country', have: s.docsUp >= 1 },
      { name: 'Health insurance', meta: 'household cover', have: s.docsUp >= 2 },
      { name: 'Proof of accommodation', meta: 'lease or deed in Curaçao', have: s.docsUp >= 3 }
    ];
    const docsDone = docList.filter(d => d.have).length, docsTotal = docList.length, docsReady = docsDone === docsTotal;
    const readyCount = [idReady, contReady, docsReady, revReady].filter(Boolean).length;
    const allReady = readyCount === 4;
    const readiness = [
      { title: 'Identity verified', meta: idReady ? 'Self proof · kade.kyc.v1 issued' : 'Passport scan with Self · zero-knowledge', done: idReady, action: 'Verify with Self', go: () => this.setState({ selfOpen: true }) },
      { title: 'Qualified holdings meet ' + tierSel.name + ' tier', meta: this.usd(qual) + ' of ' + this.usd(tierSel.min) + (contReady ? '' : ' · ' + this.usd(tierSel.min - qual) + ' to go'), done: contReady, action: 'Move funds', go: () => { this.setState({ screen: 'holdings' }); window.scrollTo(0, 0); } },
      { title: 'Documents complete', meta: docsDone + ' of ' + docsTotal + ' uploaded · hashed & pinned', done: docsReady, action: 'Upload', go: () => this.setState(st => ({ docsUp: Math.min(3, st.docsUp + 1) })) },
      { title: 'Intake review cleared', meta: revReady ? 'kade.review.v1 signed by reviewer' : 'Admin reviews within 3 days — nothing to do', done: revReady, action: '', go: null }
    ].map(r => Object.assign({}, r, { mark: r.done ? '✓' : '·', bg: r.done ? '#0063B5' : '#F2F4F7', fg: r.done ? '#fff' : '#667085', hasAction: !r.done && !!r.action }));
    const resStagesDef = [
      ['Package compiled & submitted', 'Identity, containers, documents, fee receipts · one signed package', 'Completed'],
      ['Immigration Service review', 'Fast-track lane · decision due 29 Sep', 'In progress'],
      ['Permit decision', tierSel.name + ' investor permit + ' + household.length + ' derived permits', 'Queued'],
      ['Biometrics & residence cards', 'One appointment for the household', 'Queued'],
      ['Kranshi registration', 'Population register · address · ID number', 'Queued'],
      ['kade.permit.v1 issued', 'Verifiable by banks, landlords, schools', 'Queued']
    ];
    const resStages = resStagesDef.map((d, i) => { const st = d[2]; const done = st === 'Completed', act = st === 'In progress'; return { n: done ? '✓' : String(i + 1), title: d[0], meta: d[1], status: st, color: done ? '#1B7F5A' : act ? '#B7791F' : '#667085', nBg: done ? '#0063B5' : act ? '#FDF6E7' : '#F2F4F7', nFg: done ? '#fff' : act ? '#B7791F' : '#667085', op: done || act ? 1 : .6 }; });
    const totalFees = feeUsdcN + (s.svcPaid ? 2000 : 0);
    const lockedOp = inReview ? .6 : 1;
    const keys = ['overview', 'application', 'vote', 'holdings', 'vault', 'invest', 'gos', 'card'];
    const go = {}, navBg = {}, navFg = {};
    keys.forEach(k => { go[k] = () => { this.setState({ screen: k }); window.scrollTo(0, 0); }; navBg[k] = s.screen === k ? '#EAF2FC' : 'transparent'; navFg[k] = s.screen === k ? '#0063B5' : '#344054'; });
    ['queue', 'treasury'].forEach(k => { go[k] = () => { this.setState({ ascreen: k }); window.scrollTo(0, 0); }; navBg[k] = s.ascreen === k ? '#EAF2FC' : 'transparent'; navFg[k] = s.ascreen === k ? '#0063B5' : '#344054'; });
    // admin queue (would come from Supabase: applications, review_events)
    const Q = [
      { ref: 'CW-2026-0409', name: 'Marcus Feldt', cit: s.cits.map(c => c.code).join(' / '), hh: 4, tier: '5-year', wealth: 452791, qual: qual, fee: feeUsdcN + ' USDC', safe: '0x5Af1…c09D', feeUid: '0x41c9…02be', appUid: '0x77aa…19c3', id: 'Passport verified', docs: '7 of 9', note: 'Provenance clean. Waiting on bank references before permit decision — no reason to hold pre-approval.', st: s.reviewed ? 'approved' : 'pending' },
      { ref: 'CW-2026-0412', name: 'Amara Okafor', cit: 'NG / GB', hh: 2, tier: '3-year', wealth: 318400, qual: 290000, fee: '391 USDC', safe: '0x8Bc2…11e0', feeUid: '0x5d10…7a3c', appUid: '0x9e21…0bf4', id: 'Passport verified', docs: '6 of 6', note: 'Complete file. Approve.', st: 'pending' },
      { ref: 'CW-2026-0415', name: 'Tomás Herrera', cit: 'AR', hh: 1, tier: '3-year', wealth: 271200, qual: 120000, fee: '335 USDC', safe: '0x2F9a…d4c7', feeUid: '0x0a77…c1e9', appUid: '0x33b8…e5a2', id: 'Pending', docs: '2 of 5', note: 'Proof of wealth below 3-year tier; identity not yet verified. Hold, do not block yet.', st: 'pending' },
      { ref: 'CW-2026-0402', name: 'Yuki Tanaka', cit: 'JP', hh: 3, tier: 'Indefinite', wealth: 1240000, qual: 912000, fee: '447 USDC', safe: '0xC4e1…9a02', feeUid: '0x88f0…12d3', appUid: '0x14cc…7be0', id: 'Passport verified', docs: '8 of 8', note: 'Approved 12 Sep. Permit decision in progress.', st: 'approved' },
      { ref: 'CW-2026-0398', name: 'Pieter de Vries', cit: 'NL', hh: 2, tier: '5-year', wealth: 610000, qual: 480000, fee: '391 USDC', safe: '0x7A30…e6f1', feeUid: '0x2c4d…9910', appUid: '0x6a0e…3c77', id: 'Passport verified', docs: '7 of 7', note: 'Approved 09 Sep.', st: 'approved' },
      { ref: 'CW-2026-0391', name: 'Sergei Volkov', cit: 'RU / CY', hh: 1, tier: '5-year', wealth: 980000, qual: 0, fee: '335 USDC', safe: '0xE9b7…04aa', feeUid: '0x7f31…b2e4', appUid: '0x0d5a…61c8', id: 'Passport verified', docs: '3 of 5', note: 'Sanctions screening hit on a linked wallet counterparty. Blocked pending enhanced due diligence.', st: 'blocked' }
    ];
    const tierMin = { '3-year': 280000, '5-year': 425000, 'Indefinite': 850000 };
    const queue = Q.map(q => {
      const st = s.decisions[q.ref] || q.st;
      const color = st === 'approved' ? '#1B7F5A' : st === 'blocked' ? '#B42318' : '#B7791F';
      const svcPaid = q.ref === 'CW-2026-0409' ? s.svcPaid : (q.ref === 'CW-2026-0402' || q.ref === 'CW-2026-0398');
      return Object.assign({}, q, {
        status: st === 'approved' ? 'Approved' : st === 'blocked' ? 'Blocked' : 'In review', color: color,
        pending: st === 'pending', decided: st !== 'pending', open: s.openQ === q.ref,
        wealth: this.usd(q.wealth), qual: this.usd(q.qual), qualColor: q.qual >= tierMin[q.tier] ? '#1B7F5A' : '#B7791F',
        idColor: q.id === 'Pending' ? '#B7791F' : '#1B7F5A', idStatus: q.id,
        svc: svcPaid ? '+ 2,000 service ✓' : 'service fee pending', svcColor: svcPaid ? '#1B7F5A' : '#667085',
        resStage: svcPaid ? (q.ref === 'CW-2026-0398' ? 'permit issued · kade.permit.v1' : 'submitted · Immigration review') : 'not started', reviewUid: st === 'pending' ? 'not yet issued' : 'kade.review.v1 · 0x1d0f…9e44',
        toggle: () => this.setState(p => ({ openQ: p.openQ === q.ref ? null : q.ref })),
        approve: () => this.setState(p => { const d = Object.assign({}, p.decisions); d[q.ref] = 'approved'; return { decisions: d, reviewed: q.ref === 'CW-2026-0409' ? true : p.reviewed }; }),
        block: () => this.setState(p => { const d = Object.assign({}, p.decisions); d[q.ref] = 'blocked'; return { decisions: d, reviewed: q.ref === 'CW-2026-0409' ? false : p.reviewed }; }),
        reopen: () => this.setState(p => { const d = Object.assign({}, p.decisions); d[q.ref] = 'pending'; return { decisions: d, reviewed: q.ref === 'CW-2026-0409' ? false : p.reviewed }; })
      });
    });
    const laneOf = q => q.svc.indexOf('✓') > -1 ? 'res' : 'pre';
    const ageOf = { 'CW-2026-0409': 1, 'CW-2026-0412': 4, 'CW-2026-0415': 9, 'CW-2026-0402': 14, 'CW-2026-0398': 21, 'CW-2026-0391': 28 };
    const queueAll = queue.map(q => Object.assign({}, q, { lane: laneOf(q), days: ageOf[q.ref] || 0, wealthN: parseFloat(String(q.wealth).replace(/[^0-9.]/g, '')) }));
    queueAll.forEach(q => { q.ageLabel = q.days === 0 ? 'today' : 'day ' + q.days; q.ageColor = q.days > 3 && q.status === 'In review' ? '#B42318' : '#667085'; });
    const laneRows = queueAll.filter(q => s.lane === 'all' || q.lane === s.lane);
    const term = s.search.trim().toLowerCase();
    let filtered = laneRows.filter(q => {
      if (term && !(q.ref + ' ' + q.name + ' ' + q.safe).toLowerCase().includes(term)) return false;
      if (s.fStatus !== 'all') { const want = s.fStatus === 'pending' ? 'In review' : s.fStatus === 'approved' ? 'Approved' : 'Blocked'; if (q.status !== want) return false; }
      if (s.fTier !== 'all' && q.tier !== s.fTier) return false;
      if (s.fQual !== 'all') { const met = q.qualColor === '#1B7F5A'; if (s.fQual === 'met' ? !met : met) return false; }
      return true;
    });
    if (s.fSort === 'wealth') filtered = filtered.slice().sort((a, b) => b.wealthN - a.wealthN);
    else if (s.fSort === 'name') filtered = filtered.slice().sort((a, b) => a.name.localeCompare(b.name));
    else filtered = filtered.slice().sort((a, b) => b.days - a.days);
    const qCounts = { pending: queue.filter(q => q.pending).length, approved: queue.filter(q => q.status === 'Approved').length, blocked: queue.filter(q => q.status === 'Blocked').length };
    const qFees = Q.reduce((a, q) => a + parseInt(q.fee), 0) + 2000 * (2 + (s.svcPaid ? 1 : 0));
    const ledger0 = Q.slice(0, 5).map((q, i) => ({ d: ['14 Sep', '12 Sep', '11 Sep', '09 Sep', '06 Sep'][i], what: 'Application fee · ' + q.tier, from: q.safe + ' · ' + q.ref, tx: '0x' + q.feeUid.slice(2, 6) + '…' + q.feeUid.slice(-4), amt: '+ ' + q.fee }));
    const ledger = [{ d: '12 Sep', what: 'Residency service fee', from: '0xC4e1…9a02 · CW-2026-0402', tx: '0x9a12…f0e3', amt: '+ 2,000 USDC' }].concat(s.svcPaid ? [{ d: '15 Sep', what: 'Residency service fee', from: '0x5Af1…c09D · CW-2026-0409', tx: '0x3e9a…c410', amt: '+ 2,000 USDC' }] : []).concat(ledger0);
    const schemas = [
      { id: 'kade.kyc.v1', fields: 'nationality · over18 · notSanctioned · selfNullifier · expiresAt', count: 5 },
      { id: 'kade.fee.v1', fields: 'applicationRef · amountUSDC · txHash · feeType', count: 6 },
      { id: 'kade.application.v1', fields: 'applicationRef · tier · docsRoot · qualifyingBalance', count: 6 },
      { id: 'kade.review.v1', fields: 'applicationRef · cleared · note', count: qCounts.approved + qCounts.blocked },
      { id: 'kade.permit.v1', fields: 'applicationRef · tier · validUntil', count: 1 }
    ];
    const instDefs = [
      { k: 'aqua', name: 'Aqualectra 2025–2032 · AQUA-A1', venue: 'DCSX · feeder', type: 'Bond', terms: '5.00% semi-annual', min: '$2,800', chain: 'Ethereum', chainColor: '#627EEA' },
      { k: 'soms', name: 'Staatsolie 2025–2033 · SOMS-25-A1', venue: 'DCSX', type: 'Bond', terms: 'USD · 7.75%', min: '$100', chain: 'Ethereum', chainColor: '#627EEA' },
      { k: 'usdy', name: 'Ondo USDY', venue: 'Ondo · Arbitrum vault', type: 'Tokenized treasury', terms: '3.37% APY', min: '$500', chain: 'Arbitrum', chainColor: '#2D374B' },
      { k: 'morpho', name: 'Morpho USDC vault · Base', venue: 'Morpho Blue · Base vault', type: 'Lending vault', terms: '4.62% APY · variable', min: '$100', chain: 'Base', chainColor: '#0052FF' },
      { k: 'latam', name: 'LATAM EM Fund · Portfolio B', venue: 'DCSX', type: 'Fund', terms: 'Growth & fintech', min: '$10,000', chain: 'Ethereum', chainColor: '#627EEA' }
    ];
    const instruments = instDefs.map(d => ({ name: d.name, venue: d.venue, type: d.type, terms: d.terms, min: d.min, chain: d.chain, chainColor: d.chainColor, held: !!s.alloc[d.k], free: !s.alloc[d.k], heldFmt: this.usd(s.alloc[d.k] || 0) + ' held', buy: () => this.setState({ invPick: d.k, investAmt: String(Math.max(10000, parseInt(String(d.min).replace(/[^0-9]/g, '')) || 10000)) }) }));
    const invSel = instDefs.find(d => d.k === s.invPick) || null;
    return {
      isSetup: !dash, isDash: dash, isSetupR: !admin && !dash, isDashR: !admin && dash, isAdmin: admin, showReviewBar: !admin && inReview, inReview: inReview,
      isQueue: admin && s.ascreen === 'queue', isTreasury: admin && s.ascreen === 'treasury',
      setResident: () => this.setState({ mode: 'resident' }), setAdmin: () => this.setState({ mode: 'admin' }),
      modeBg: { resident: !admin ? '#fff' : 'transparent', admin: admin ? '#fff' : 'transparent' }, modeFg: { resident: !admin ? '#0063B5' : '#667085', admin: admin ? '#0063B5' : '#667085' },
      tiers: TIERS.map((t, i) => ({ name: t.name, min: this.usd(t.min) + '+', border: s.tier === i ? '#0A7CFF' : '#EAEDF1', pick: () => this.setState({ tier: i }) })),
      tierName: tierSel.name, tierMinFmt: this.usd(tierSel.min), tierMarkPct: Math.min(100, tierSel.min / 850000 * 100) + '%', tierMarkPct850: Math.min(100, tierSel.min / 850000 * 100) + '%',
      wealthPct: Math.min(linkedTotal / 850000, 1) * 100 + '%', wealthColor: linkedTotal >= tierSel.min ? '#1B7F5A' : '#B7791F',
      wealthLabel: linkedTotal >= tierSel.min ? 'Meets ' + tierSel.name + ' tier — ' + this.usd(linkedTotal - tierSel.min) + ' headroom' : this.usd(tierSel.min - linkedTotal) + ' short of ' + tierSel.name + ' tier',
      noWallets: linkedWallets.length === 0, wealthNumColor: linkedWallets.length ? '#101828' : '#98A2B3',
      linkedSub: linkedWallets.length ? linkedWallets.length + ' wallets · provenance clean' : 'Connect a wallet to begin',
      wealthBtnBg: linkedWallets.length ? '#0A7CFF' : '#98A2B3', wealthCursor: linkedWallets.length ? 'pointer' : 'not-allowed',
      wealthBtnLabel: linkedWallets.length ? 'Continue' : 'Connect a wallet to continue',
      nextWealth: () => { if (linkedWallets.length) this.setState(st => ({ step: Math.min(3, st.step + 1) })); },
      cits: s.cits.map((c, i) => ({ name: c.name, flag: 'https://flagcdn.com/w40/' + c.code.toLowerCase() + '.png', remove: () => this.setState(st => ({ cits: st.cits.length > 1 ? st.cits.filter((_, j) => j !== i) : st.cits })) })),
      ress: s.ress.map((c, i) => ({ name: c.name, years: c.years, flag: 'https://flagcdn.com/w40/' + c.code.toLowerCase() + '.png', remove: () => this.setState(st => ({ ress: st.ress.length > 1 ? st.ress.filter((_, j) => j !== i) : st.ress })) })),
      citOptions: COUNTRIES.filter(c => !s.cits.some(x => x.code === c.code)),
      resOptions: COUNTRIES.filter(c => !s.ress.some(x => x.code === c.code)),
      addCit: e => { const code = e.target.value; e.target.value = ''; const c = COUNTRIES.find(x => x.code === code); if (c) this.setState(st => ({ cits: st.cits.concat([{ code: c.code, name: c.name }]) })); },
      addRes: e => { const code = e.target.value; e.target.value = ''; const c = COUNTRIES.find(x => x.code === code); if (c) this.setState(st => ({ ress: st.ress.concat([{ code: c.code, name: c.name, years: '2019–2022' }]) })); },
      household: household, addMember: () => this.setState(st => ({ members: Math.min(4, st.members + 1) })),
      depCount: s.members, depFeeXcg: 'XCG ' + (100 * s.members), feeUsdc: feeUsdcN, feeXcg: 'XCG ' + (500 + 100 * s.members),
      unqualNote: linkedWallets.length ? 'proof of wealth · not counted' : 'no wallets connected',
      unqualFmt: this.usd(deps.filter(d => !s.vault[d.k]).reduce((a, d) => a + (d.k === 'usdc' ? 150000 : d.val), 0)),
      lanes: [
        { key: 'pre', label: 'Pre-approval', count: queueAll.filter(q => q.lane === 'pre').length },
        { key: 'res', label: 'Residency applications', count: queueAll.filter(q => q.lane === 'res').length },
        { key: 'all', label: 'All', count: queueAll.length }
      ].map(l => ({ label: l.label, count: l.count, bg: s.lane === l.key ? '#101828' : 'transparent', fg: s.lane === l.key ? '#fff' : '#344054', pick: () => this.setState({ lane: l.key }) })),
      search: s.search, onSearch: e => this.setState({ search: e.target.value }),
      fStatus: s.fStatus, onStatus: e => this.setState({ fStatus: e.target.value }),
      fTier: s.fTier, onTier: e => this.setState({ fTier: e.target.value }),
      fQual: s.fQual, onQual: e => this.setState({ fQual: e.target.value }),
      fSort: s.fSort, onSort: e => this.setState({ fSort: e.target.value }),
      hasFilters: !!(term || s.fStatus !== 'all' || s.fTier !== 'all' || s.fQual !== 'all' || s.fSort !== 'age'),
      clearFilters: () => this.setState({ search: '', fStatus: 'all', fTier: 'all', fQual: 'all', fSort: 'age' }),
      shownCount: filtered.length + ' of ' + queueAll.length + ' shown',
      noResults: filtered.length === 0,
      qResidency: queueAll.filter(q => q.lane === 'res').length,
      queue: filtered, qPending: qCounts.pending, qApproved: qCounts.approved, qBlocked: qCounts.blocked, qFees: qFees.toLocaleString('en-US'),
      ledger: ledger, schemas: schemas,
      go: go, navBg: navBg, navFg: navFg,
      isOverview: dash && s.screen === 'overview', isApplication: dash && s.screen === 'application', isVote: dash && s.screen === 'vote',
      isHoldings: dash && s.screen === 'holdings', isVault: dash && s.screen === 'vault', isInvest: dash && s.screen === 'invest', isGos: dash && s.screen === 'gos', isCard: dash && s.screen === 'card',
      totalFmt: this.usd(qual + deps.filter(d => !s.vault[d.k]).reduce((a, d) => a + (d.k === 'usdc' ? 150000 : d.val), 0)),
      investOpen: !!s.invPick, investName: invSel ? invSel.name : '', investVenue: invSel ? invSel.venue : '', investTerms: invSel ? invSel.terms : '', investMin: invSel ? invSel.min : '', investChain: invSel ? invSel.chain : '', investChainColor: invSel ? invSel.chainColor : '#627EEA',
      investAmt: s.investAmt, onInvestAmt: e => this.setState({ investAmt: e.target.value.replace(/[^0-9]/g, '') }),
      investAmtFmt: this.usd(Number(s.investAmt || 0)), investIncome: this.usd(Number(s.investAmt || 0) * 0.05) + ' / yr est.',
      investAfter: this.usd(Math.max(0, (s.vault.usdc ? 150000 : 0) - allocTotal - Number(s.investAmt || 0))),
      investPresets: [10000, 25000, 50000].map(v => ({ label: '$' + (v / 1000) + 'k', bg: String(v) === String(s.investAmt) ? '#101828' : '#fff', fg: String(v) === String(s.investAmt) ? '#fff' : '#344054', pick: () => this.setState({ investAmt: String(v) }) })),
      closeInvest: () => this.setState({ invPick: null }),
      confirmInvest: () => this.setState(st => { const a = Object.assign({}, st.alloc); const used = Object.keys(a).reduce((x, k) => x + (k === st.invPick ? 0 : a[k]), 0); const avail = Math.max(0, (st.vault.usdc ? 150000 : 0) - used); if (st.invPick) a[st.invPick] = Math.min(Number(st.investAmt || 0), avail); return { alloc: a, invPick: null }; }),
      // card top-up
      topupShown: !!s.tuOpen, openTopup: () => this.setState({ tuOpen: true }), closeTopup: () => this.setState({ tuOpen: false }),
      topupAmt: s.topupAmt, onTopupAmt: e => this.setState({ topupAmt: e.target.value.replace(/[^0-9]/g, '') }),
      topupXcg: 'XCG ' + Math.round(Number(s.topupAmt || 0) * 1.79).toLocaleString('en-US'),
      isVaultSrc: s.topupSrc === 'vault', isDepositSrc: s.topupSrc === 'deposit',
      pickVault: () => this.setState({ topupSrc: 'vault' }), pickDeposit: () => this.setState({ topupSrc: 'deposit' }),
      vaultSrcBorder: s.topupSrc === 'vault' ? '#0A7CFF' : '#EAEDF1', depositSrcBorder: s.topupSrc === 'deposit' ? '#0A7CFF' : '#EAEDF1',
      topupCta: s.topupSrc === 'vault' ? 'Move to card balance' : 'I have sent the funds',
      // GOS send
      sendOpen: s.sendOpen, openSend: () => this.setState({ sendOpen: true }), closeSend: () => this.setState({ sendOpen: false }),
      sendAmt: s.sendAmt, onSendAmt: e => this.setState({ sendAmt: e.target.value.replace(/[^0-9]/g, '') }),
      sendIban: s.sendIban, onSendIban: e => this.setState({ sendIban: e.target.value }),
      sendName: s.sendName, onSendName: e => this.setState({ sendName: e.target.value }),
      sendEur: '€' + Math.round(Number(s.sendAmt || 0) * 0.92 * 0.99).toLocaleString('en-US'),
      sendFee: '$' + Math.round(Number(s.sendAmt || 0) * 0.01).toLocaleString('en-US'),
      sendLocked: inReview,
      bridgeNoteIn: s.depChain === 'Ethereum' ? 'Received directly on Ethereum — our settlement network.' : 'Received on ' + s.depChain + ' · bridged to Ethereum for card settlement · ~2 min, no extra fee.',
      bridgeNote: s.depChain === 'Ethereum' ? 'Settles directly on Ethereum — our on/off-ramp network.' : 'Settles on Ethereum first, then bridges to ' + s.depChain + ' automatically · ~2 min, no extra fee.',
      bridgeNoteOut: s.depChain === 'Ethereum' ? 'Paid straight from the Ethereum vault — our on/off-ramp network.' : 'Bridged from ' + s.depChain + ' to Ethereum for settlement · ~2 min, included in the 1% fee.',
      selfShown: !!s.selfOpen, closeSelf: () => this.setState({ selfOpen: false }), confirmSelf: () => this.setState({ selfOpen: false, kyc: true }),
      depositChain: s.depChain, depositConfs: s.depChain === 'Ethereum' ? '3 confirmations' : '~10 seconds',
      depositChains: [{ n: 'Ethereum', c: '#627EEA' }, { n: 'Base', c: '#0052FF' }, { n: 'Arbitrum', c: '#2D374B' }].map(c => Object.assign({}, c, { border: s.depChain === c.n ? '#0A7CFF' : '#EAEDF1', pick: () => this.setState({ depChain: c.n }) })),
      chainTotals: (() => {
        const defs = [
          { n: 'Ethereum', c: '#627EEA', vault: true },
          { n: 'Base', c: '#0052FF', vault: true },
          { n: 'Arbitrum', c: '#2D374B', vault: true },
          { n: 'Optimism', c: '#FF0420', vault: false },
          { n: 'Celo', c: '#FCFF52', vault: false }
        ];
        const tally = {};
        provs.forEach(p => { (p.chains || []).forEach(c => { tally[c.n] = (tally[c.n] || 0) + c.v; }); if (!p.evm) tally['Ethereum'] = (tally['Ethereum'] || 0) + p.val; });
        return defs.map(d => ({ n: d.n, c: d.c, vFmt: this.usd(tally[d.n] || 0), sub: d.vault ? 'Vault available' : 'Read-only', subColor: d.vault ? '#1B7F5A' : '#667085' }));
      })(),
      reflectOn: s.reflect, reflectOff: !s.reflect, reflectApy: '4.15%',
      reflectAvailFmt: this.usd(usdcVal), reflectBalFmt: this.usd(usdcVal), reflectEarnedFmt: this.usd(usdcVal * 0.0043),
      reflectYearFmt: this.usd(usdcVal * 0.0415), reflectSrc: this.usd(usdcVal) + ' USDC',
      reflectBtnLabel: s.reflect ? 'Redeem to USDC' : 'Convert to USDT+',
      reflectBtnBg: s.reflect ? '#fff' : '#0A7CFF', reflectBtnFg: s.reflect ? '#101828' : '#fff', reflectBtnBorder: s.reflect ? '1px solid #101828' : '0',
      toggleReflect: () => this.setState(st => ({ reflect: !st.reflect })),
      walletAssets: deposits.filter(d => d.out).map(d => d.k === 'usdc' ? Object.assign({}, d, { amt: '150,000', val: 150000, valFmt: this.usd(150000) }) : d), noWalletAssets: deposits.filter(d => d.out).length === 0,
      noQualified: vaultRows.length === 0 && Object.keys(s.alloc).length === 0,
      allocRows: instDefs.filter(d => s.alloc[d.k]).map(d => ({ name: d.name, venue: d.venue, terms: d.terms, chain: d.chain, chainColor: d.chainColor, valFmt: this.usd(s.alloc[d.k]) })),
      instruments: instruments, allocFmt: this.usd(allocTotal), allocCount: Object.keys(s.alloc).length, usdcFreeFmt: this.usd(Math.max(0, (s.vault.usdc ? 150000 : 0) - allocTotal)),
      isStep0: !dash && s.step === 0, isStep1: !dash && s.step === 1, isStep2: !dash && s.step === 2, isStep3: !dash && s.step === 3,
      steps: steps, next: () => this.setState(st => ({ step: Math.min(3, st.step + 1) })), back: () => this.setState(st => ({ step: Math.max(0, st.step - 1) })),
      kycDot: s.kyc ? '#1B7F5A' : '#B7791F', kycLabel: s.kyc ? 'Issued' : 'Pending', kycUid: s.kyc ? '0x9c2e…41af' : '—',
      kycBtnBg: s.kyc ? '#0A7CFF' : '#101828', kycBtnLabel: s.kyc ? 'Continue' : 'Issue attestation & continue',
      issueKyc: () => { if (s.kyc) this.setState({ step: 2 }); else this.setState({ kyc: true }); },
      providers: providers,
      connectOpen: !!s.connecting, connectName: s.connecting ? s.connecting.name : '', connectIco: s.connecting ? s.connecting.ico : '', connectColor: s.connecting ? s.connecting.color : '#101828', connectChain: s.connecting ? s.connecting.chain : '', connectAddr: s.connecting ? s.connecting.addr : '', connectAssets: s.connecting ? s.connecting.assets : '', connectVal: s.connecting ? this.usd(s.connecting.val) : '', connectIsBtc: s.connecting ? s.connecting.k === 'btc' : false, connectIsEvm: s.connecting ? (s.connecting.k === 'mm' || s.connecting.k === 'lg') : true, connectIsQr: s.connecting ? s.connecting.k === 'cb' : false,
      connectCta: s.connecting ? (s.connecting.k === 'btc' ? 'Add watch-only key' : s.connecting.k === 'cb' ? 'I scanned it — continue' : 'Sign message') : 'Sign message',
      qrCells: (() => { const out = []; let seed = 7; for (let i = 0; i < 121; i++) { const r = Math.floor(i / 11), c = i % 11; const finder = (r < 3 && c < 3) || (r < 3 && c > 7) || (r > 7 && c < 3); seed = (seed * 1103515245 + 12345) & 0x7fffffff; out.push({ c: finder ? '#101828' : ((seed >> 8) % 100 < 46 ? '#101828' : '#fff') }); } return out; })(),
      connectSub: s.connecting ? s.connecting.sub : '',
      connectHint: s.connecting ? (s.connecting.k === 'btc' ? 'Preview of the key import — in the live app you paste your own xpub.' : s.connecting.k === 'cb' ? 'Preview of the WalletConnect QR — in the live app this code is live for 60 seconds.' : 'Preview of the wallet prompt — in the live app this opens in your extension or device.') : '',
      closeConnect: () => this.setState({ connecting: null }),
      confirmConnect: () => this.setState(st => { const l = Object.assign({}, st.linked); if (st.connecting) l[st.connecting.k] = true; return { linked: l, connecting: null }; }),
      stopProp: e => e.stopPropagation(), linkedWallets: linkedWallets, linkedFmt: this.usd(linkedTotal), linkedCount: linkedWallets.length, provLabel: 'clean',
      deposits: deposits, vaultRows: vaultRows, qualFmt: this.usd(qual), qualPct: Math.min(qual / 850000, 1) * 100 + '%', tierLabel: tier, tierColor: tierColor,
      summary: [
        { k: 'Applicant', v: 'Marcus Feldt · ' + s.cits.map(c => c.code).join(' / ') + ' · 14 Mar 1982', s: 'Profile', c: '#1B7F5A' },
        { k: 'Residence', v: s.ress.map(r => r.code + ' ' + r.years).join(' · '), s: s.ress.length + ' clearance' + (s.ress.length === 1 ? '' : 's'), c: '#1B7F5A' },
        { k: 'Household', v: household.map(m => m.name.split(' ')[0]).join(', ') + ' · ' + s.members + ' derived permits', s: 'Listed', c: '#1B7F5A' },
        { k: 'Target tier', v: tierSel.name + ' · ' + this.usd(tierSel.min) + ' qualifying', s: 'Selected', c: '#1B7F5A' },
        { k: 'Proof of wealth', v: linkedWallets.length + ' wallets · ' + this.usd(linkedTotal) + ' · provenance clean', s: linkedTotal >= tierSel.min ? 'Meets tier' : 'Below tier', c: linkedTotal >= tierSel.min ? '#1B7F5A' : '#B7791F' }
      ],
      feePaid: s.paid, feeUnpaid: !s.paid,
      feeCardBg: s.paid ? '#0063B5' : '#101828', feeCardBorder: s.paid ? '#0063B5' : '#101828', feeCardFg: '#fff',
      feeBtnBg: s.paid ? '#fff' : '#0A7CFF', feeBtnFg: s.paid ? '#0063B5' : '#fff', feeBtnLabel: s.paid ? 'Enter the platform →' : 'Pay now to start pre-approval',
      payFee: () => { if (s.paid) this.setState({ done: true, screen: 'overview' }); else this.setState({ paid: true }); },
      restart: () => this.setState({ done: false, step: 0, paid: false, reviewed: false, decisions: {}, mode: 'resident', svcPaid: false, docsUp: 0, kyc: false }),
      toggleReview: () => this.setState(st => ({ reviewed: !st.reviewed })),
      reviewBg: s.reviewed ? '#EAF6F0' : '#FDF6E7', reviewFg: s.reviewed ? '#1B7F5A' : '#B7791F', reviewShort: s.reviewed ? 'Review cleared' : 'Pre-approved', reviewLabel: s.reviewed ? 'Intake review cleared' : 'Pre-approved · in review',
      statusWord: s.reviewed ? 'Approved' : 'Pre-approved', statusSub: s.reviewed ? 'Intake cleared · permit decision pending' : 'Intake review in progress',
      dashSub: s.reviewed ? 'Intake review cleared with no issues. Card, payouts and borrowing are unlocked while Immigration finalises the permit decision.' : 'Your fee is paid and your account is pre-approved. Next: move funds into a qualified vault so they count toward your permit. Card, payouts and borrowing unlock once intake review completes.',
      attCount: receipts.length, attSub: s.reviewed ? 'KYC · fee · application · review' : 'KYC · fee · application',
      stages: stages, receipts: receipts,
      resPre: !s.svcPaid, resPost: s.svcPaid,
      resTitle: s.svcPaid ? 'Residency' : 'Start Residency', resSub: s.svcPaid ? 'Your package is with the Immigration Service — every stage is attested onchain.' : 'Clear all four checks, pay the service fee, and we submit your full package.',
      resChip: s.svcPaid ? 'Submitted · in review' : allReady ? 'Ready to start' : readyCount + ' of 4 ready', resChipBg: s.svcPaid || allReady ? '#EAF6F0' : '#FDF6E7', resChipFg: s.svcPaid || allReady ? '#1B7F5A' : '#B7791F',
      readiness: readiness, readyCount: readyCount,
      svcBg: allReady ? '#0063B5' : '#FAFAFA', svcBorder: allReady ? '#0063B5' : '#EAEDF1', svcFg: allReady ? '#fff' : '#101828',
      svcBtnBg: allReady ? '#fff' : '#98A2B3', svcBtnFg: allReady ? '#0063B5' : '#fff', svcCursor: allReady ? 'pointer' : 'not-allowed',
      svcBtnLabel: allReady ? 'Pay 2,000 USDC & start residency' : 'Complete the checks above to unlock',
      paySvc: () => { if (allReady) this.setState({ svcPaid: true }); },
      resStages: resStages, docs: docList.map(d => ({ name: d.name, meta: d.meta, status: d.have ? 'Verified' : 'Missing', color: d.have ? '#1B7F5A' : '#B7791F' })), docsDone: docsDone, docsTotal: docsTotal,
      uploadDoc: () => this.setState(st => ({ docsUp: Math.min(3, st.docsUp + 1) })),
      totalFeesFmt: totalFees.toLocaleString('en-US') + ' USDC', feesSub: s.svcPaid ? '2 receipts · pre-approval + service' : '1 receipt · pre-approval',
      ovResTitle: s.svcPaid ? 'Residency · CW-2026-0409' : 'Getting ready for residency',
      ovResNext: s.svcPaid ? 'Track residency status' : allReady ? 'Start Residency — pay service fee' : 'Start Residency — ' + readyCount + ' of 4 ready',
      ovResState: s.svcPaid ? 'In review' : allReady ? 'Ready' : 'Open', ovResColor: s.svcPaid || allReady ? '#1B7F5A' : '#B7791F',
      lockedOp: lockedOp, lockNote: inReview ? 'unlocks after review' : 'available now', lockBtn: inReview ? 'Locked' : 'Draw USDC', lockCursor: inReview ? 'not-allowed' : 'pointer',
      // GOS
      fundShown: !!s.fundOpen, openFund: () => this.setState({ fundOpen: true }), closeFund: () => this.setState({ fundOpen: false }),
      fundCcys: ['USD', 'EUR', 'XCG'].map(c => ({ label: c, bg: s.fundCcy === c ? '#101828' : 'transparent', fg: s.fundCcy === c ? '#fff' : '#344054', pick: () => this.setState({ fundCcy: c }) })),
      fundAcctLabel: s.fundCcy === 'EUR' ? 'IBAN' : 'Account', fundBicLabel: s.fundCcy === 'USD' ? 'Routing' : 'BIC',
      fundAcct: s.fundCcy === 'EUR' ? 'NL42 GOSP 0417 8821 30' : s.fundCcy === 'USD' ? '8813 4420 7719' : 'CW17 VIDA 0044 2281 90',
      fundBic: s.fundCcy === 'EUR' ? 'GOSPNL2A' : s.fundCcy === 'USD' ? '021000021' : 'VIDACW22',
      fundBank: s.fundCcy === 'EUR' ? 'GOS Payments · Amsterdam' : s.fundCcy === 'USD' ? 'JPMorgan Chase · New York' : 'Vidanova Bank · Willemstad',
      fundEta: s.fundCcy === 'EUR' ? 'SEPA instant · minutes' : s.fundCcy === 'USD' ? 'ACH 1 day · wire same day' : 'local transfer · same day',
      fundHistory: [
        { what: 'EUR 22,000 · Commerzbank', d: '02 Sep', ref: 'GOS-8841', recv: '+ 23,795 USDC', status: 'Credited', color: '#1B7F5A' },
        { what: 'USD 25,000 · JPMorgan wire', d: '21 Aug', ref: 'GOS-8620', recv: '+ 24,875 USDC', status: 'Credited', color: '#1B7F5A' },
        { what: 'USD 15,000 · SWIFT in transit', d: '14 Sep', ref: 'GOS-9012', recv: 'pending', status: 'In progress', color: '#B7791F' }
      ],
      cashHistory: [
        { what: 'XCG 7,500 · Vidanova ···8845', d: '28 Aug', ref: 'GOS-8703', recv: '− 4,200 USDC', status: 'Settled', color: '#1B7F5A' }
      ],
      gosHistory: [
        { d: '14 Sep', dir: 'Bank → Crypto', dirColor: '#0063B5', what: 'USD 15,000 · SWIFT', ref: 'GOS-9012', chain: 'Base', chainColor: '#0052FF', sent: '$15,000', recv: 'pending', status: 'In progress', color: '#B7791F' },
        { d: '02 Sep', dir: 'Bank → Crypto', dirColor: '#0063B5', what: 'EUR 22,000 · Commerzbank', ref: 'GOS-8841', chain: 'Ethereum', chainColor: '#627EEA', sent: '€22,000', recv: '23,795 USDC', status: 'Credited', color: '#1B7F5A' },
        { d: '28 Aug', dir: 'Crypto → Bank', dirColor: '#B7791F', what: 'Payout to Vidanova ···8845', ref: 'GOS-8703', chain: 'Arbitrum', chainColor: '#2D374B', sent: '4,200 USDC', recv: 'XCG 7,500', status: 'Settled', color: '#1B7F5A' },
        { d: '21 Aug', dir: 'Bank → Crypto', dirColor: '#0063B5', what: 'USD 25,000 · JPMorgan wire', ref: 'GOS-8620', chain: 'Ethereum', chainColor: '#627EEA', sent: '$25,000', recv: '24,875 USDC', status: 'Credited', color: '#1B7F5A' },
        { d: '09 Aug', dir: 'Bank → Crypto', dirColor: '#0063B5', what: 'EUR 13,000 · SEPA instant', ref: 'GOS-8455', chain: 'Ethereum', chainColor: '#627EEA', sent: '€13,000', recv: '14,062 USDC', status: 'Credited', color: '#1B7F5A' }
      ],
      cashOutOp: inReview ? .75 : 1, cashOutCursor: inReview ? 'not-allowed' : 'pointer', cashOutLabel: inReview ? 'Unlocks after review' : 'Cash out to bank',
      setB2C: () => this.setState({ dir: 'b2c', swapped: false }), setC2B: () => this.setState({ dir: 'c2b', swapped: false }),
      b2cBg: b2c ? '#101828' : 'transparent', b2cFg: b2c ? '#fff' : '#344054', c2bBg: !b2c ? '#101828' : 'transparent', c2bFg: !b2c ? '#fff' : '#344054',
      swapAmt: s.amt, onSwap: e => this.setState({ amt: e.target.value.replace(/[^0-9.]/g, ''), swapped: false }),
      swapFromLabel: b2c ? 'From bank · EUR' : 'From vault · USDC', swapFromSub: b2c ? 'Commerzbank ···4410 · SEPA instant' : 'Safe 0x5Af1…c09D · Ethereum',
      swapToLabel: b2c ? 'To vault · USDC' : 'To bank · XCG', swapToSub: b2c ? 'Safe 0x5Af1…c09D · Ethereum' : 'Vidanova ···8845 · Curaçao',
      swapOut: out.toLocaleString('en-US', { maximumFractionDigits: 0 }), swapRate: b2c ? '1 EUR = 1.087 USDC' : '1 USDC = 1.79 XCG', swapEta: b2c ? 'in minutes' : 'same day',
      swapBtn: c2bLocked ? 'Unlocks after review' : s.swapped ? (b2c ? 'Transfer initiated ✓' : 'Payout sent ✓') : (b2c ? 'Fund vault via GOS' : 'Send to bank via GOS'),
      swapBtnBg: c2bLocked ? '#98A2B3' : s.swapped ? '#1B7F5A' : '#0A7CFF', swapCursor: c2bLocked ? 'not-allowed' : 'pointer',
      doSwap: () => { if (!c2bLocked) this.setState({ swapped: true }); },
      // card
      cardChip: inReview ? 'Unlocks after review' : s.card ? 'Active' : 'Available', cardChipBg: inReview ? '#F2F4F7' : '#EAF6F0', cardChipFg: inReview ? '#667085' : '#1B7F5A',
      cardBtnBg: inReview ? '#98A2B3' : s.card ? '#1B7F5A' : '#0A7CFF', cardBtnLabel: inReview ? 'Order card · after intake review' : s.card ? 'Card ordered · ships in 5 days ✓' : 'Order Onchain Island Card', cardCursor: inReview ? 'not-allowed' : 'pointer',
      orderCard: () => { if (!inReview) this.setState({ card: true }); },
      cardActive: s.card && !inReview, cardInactive: !(s.card && !inReview),
      cardLead: s.card && !inReview ? 'Active since 12 Sep · spend in XCG, USDC debited from your vault.' : inReview ? 'Spend from your vault in XCG anywhere on the island. Ordering unlocks once intake review completes.' : 'Spend from your vault in XCG anywhere on the island — powered by GOS, no foreign card fees.',
      cardTx: [
        { d: '14 Sep', who: 'Van den Tweel Supermarket', meta: 'Groceries · Willemstad', xcg: '− 214.40', usdc: '− 119.78' },
        { d: '13 Sep', who: 'Aqualectra', meta: 'Utilities · direct debit', xcg: '− 410.00', usdc: '− 229.05' },
        { d: '12 Sep', who: 'Top-up from vault', meta: 'USDC → spending balance', xcg: '+ 3,580.00', usdc: '+ 2,000.00', pos: true },
        { d: '11 Sep', who: 'Kome Restaurant', meta: 'Dining · Pietermaai', xcg: '− 186.50', usdc: '− 104.19' },
        { d: '10 Sep', who: 'Curaçao Airport Duty Free', meta: 'Retail · Hato', xcg: '− 92.75', usdc: '− 51.82' },
        { d: '08 Sep', who: 'International School of Curaçao', meta: 'Tuition instalment', xcg: '− 1,835.00', usdc: '− 1,025.14' },
        { d: '06 Sep', who: 'Blue Bay Golf', meta: 'Leisure', xcg: '− 148.00', usdc: '− 82.68' },
        { d: '04 Sep', who: 'Mangusá Supermarket', meta: 'Groceries · Salinja', xcg: '− 300.60', usdc: '− 167.93' }
      ].map(t => Object.assign({}, t, { color: t.pos ? '#1B7F5A' : '#101828' })),
      applySlash: () => this.setState({ slash: true }), slashBg: s.slash ? '#101828' : '#fff', slashFg: s.slash ? '#fff' : '#101828', slashLabel: s.slash ? 'On the early-access list ✓' : 'Apply for early access',
      // vote
      choices: choices, voteChoiceLabel: s.vote === null ? 'Select an option' : labels[s.vote], voteBtnBg: s.voted ? '#1B7F5A' : s.vote === null ? '#98A2B3' : '#0A7CFF',
      voteBtnLabel: s.voted ? 'Vote recorded on Snapshot ✓' : 'Sign & cast vote', castVote: () => { if (s.vote !== null && !s.voted) this.setState({ voted: true }); },
      voteNote: s.voted ? 'Signed EIP-712 message · stored on IPFS · verifiable at snapshot.org/#/onchainisland.eth' : 'Off-chain signature, no gas. Eligibility checked against your KYC attestation — one resident, one vote.',
      turnout: (tot) + ' votes'
    };
  }
}
