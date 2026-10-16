'use strict';
/*
 * SPL EIU Companion - DEMO app.
 *
 * Everything the app "reads" from the wand and the implant is produced by
 * the simulator in this file. Nothing here talks to real hardware. The
 * charging model follows the bench numbers of the EIU project (10.38 kHz
 * coil drive, pwm-rail power level 15-33, 60 s burst + telemetry gap)
 * but time is compressed so a demo charge finishes in minutes.
 */

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const f = (v, d = 0) => Number(v).toFixed(d);
const r1 = (v) => Math.round(v * 10) / 10;
const deep = (o) => JSON.parse(JSON.stringify(o));
const tstr = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signed = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '±') + f(Math.abs(v), d);

const ICON = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  bell: '<path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 003.4 0"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  bt: '<path d="M7 7l10 10-5 5V2l5 5L7 17"/>',
  power: '<path d="M12 2v10"/><path d="M5.6 6.6a8 8 0 1012.8 0"/>',
  wave: '<path d="M2 12h3l2-6 3 12 3-9 2 3h7"/>',
  battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  brain: '<path d="M9.5 2A2.5 2.5 0 007 4.5v.3A2.5 2.5 0 004.5 7.3 2.7 2.7 0 003 9.8a2.7 2.7 0 001 2.1A3 3 0 004 16a3 3 0 003 3 2.5 2.5 0 005 0V4.5A2.5 2.5 0 009.5 2z"/><path d="M14.5 2A2.5 2.5 0 0117 4.5v.3a2.5 2.5 0 012.5 2.5 2.7 2.7 0 011.5 2.5 2.7 2.7 0 01-1 2.1A3 3 0 0120 16a3 3 0 01-3 3 2.5 2.5 0 01-5 0"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const ic = (n, s = 22) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n] || ''}</svg>`;

/* ------------------------------------------------------------------ */
/* model                                                              */
/* ------------------------------------------------------------------ */
const LEADS = {
  left: { name: 'Left STN', labels: ['0', '1', '2', '3'] },
  right: { name: 'Right STN', labels: ['8', '9', '10', '11'] },
};
const SIDES = ['left', 'right'];
const CONTACT_AREA_CM2 = 0.06;   // 6 mm² cylindrical contact
const DENSITY_LIMIT = 30;        // µC/cm² per phase
const CLIN_PIN = '2468';
const THERAPY_DRAIN_MA = 0.9;    // average implant drain with stimulation on
const BURST_ON_S = 6;            // compressed 60 s burst
const BURST_GAP_S = 1;           // compressed 2 s telemetry gap
const TICK = 0.25;               // simulation step, seconds

const PHASE = {
  idle: { label: 'Idle', cls: '' },
  searching: { label: 'Searching', cls: 'warn' },
  charging: { label: 'Charging', cls: 'ok' },
  telemetry: { label: 'Telemetry', cls: 'info' },
  complete: { label: 'Complete', cls: 'ok' },
};

function initialState() {
  return {
    connected: false,
    connect: { phase: 'idle', devices: [], step: 0 },
    role: 'patient',
    tab: 'home',
    logFilter: 'all',
    wand: { name: 'SPL-EIU-0421', hw: 'EIU rev B · MSP430FR6989', fw: '1.0.0-demo', battery: 88, rssi: -48, hv: 10.3, drive: '10.38 kHz' },
    implant: {
      model: 'SPL IPG (demo)', serial: 'SPL-IPG-26-0117', fw: '2.3.1',
      soc: 34, capacity: 215, cycles: 37, health: 96, temp: 36.8,
      stimOn: true, lastCharge: '2 days ago',
    },
    ch: {
      on: false, phase: 'idle', pos: { x: 0.62, y: -0.5 }, k: 0,
      level: 23, auto: true, cycle: 0, current: 0, rxV: 0, txV: 0, hv: 10.3,
      coilT: 26, hist: [], lowTime: 0, sessionMah: 0, onSum: 0, onN: 0,
      linkLimited: false, lastTele: null, teleCount: 0, beepAcc: 0, startSoc: 0,
    },
    programs: [
      {
        name: 'Daytime', desc: 'Standard daytime therapy', caseAnode: true,
        left: { contacts: ['off', '-', 'off', 'off'], amp: 2.5, pw: 60, freq: 130 },
        right: { contacts: ['off', '-', 'off', 'off'], amp: 2.2, pw: 60, freq: 130 },
        offset: 0, offMin: -0.5, offMax: 0.8,
      },
      {
        name: 'Walking', desc: 'Gait-focused, lower frequency', caseAnode: true,
        left: { contacts: ['off', '-', '-', 'off'], amp: 2.8, pw: 90, freq: 60 },
        right: { contacts: ['off', '-', '-', 'off'], amp: 2.6, pw: 90, freq: 60 },
        offset: 0, offMin: -0.4, offMax: 0.6,
      },
      {
        name: 'Night', desc: 'Bipolar, reduced amplitude for sleep', caseAnode: false,
        left: { contacts: ['off', '-', '+', 'off'], amp: 1.8, pw: 60, freq: 130 },
        right: { contacts: ['off', '-', '+', 'off'], amp: 1.6, pw: 60, freq: 130 },
        offset: 0, offMin: -0.3, offMax: 0.3,
      },
    ],
    active: 0,
    editIdx: 0,
    edit: null,
    imp: { running: false, progress: 0, results: null, at: null },
    settings: { beep: true, speed: 60, target: 50 },
    stats: { lfOk: 0, lfFail: 0, since: null },
    alerts: [],
    log: [],
    unread: 0,
  };
}

let S = initialState();
const alertSeen = {};

const prog = () => S.programs[S.active];
const ampEff = (p, side) => clamp(r1(p[side].amp + p.offset), 0, 10);
const vbatOf = (soc) => 3.4 + 0.8 * soc / 100;
const kOf = (pos) => { const d = Math.hypot(pos.x, pos.y); return Math.exp(-(d * d) / (0.36 * 0.36)); };

function addLog(cat, text) {
  S.log.unshift({ t: new Date(), cat, text });
  if (S.log.length > 400) S.log.pop();
}

function addAlert(key, sev, title, text, cooldownMs = 60000) {
  const n = Date.now();
  if (alertSeen[key] && n - alertSeen[key] < cooldownMs) return;
  alertSeen[key] = n;
  S.alerts.unshift({ sev, title, text, t: new Date() });
  if (S.tab !== 'alerts') S.unread++;
  toast(title, sev === 'info' ? 'ok' : sev);
  addLog('system', `${title} — ${text}`);
}

function toast(msg, sev = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + sev;
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/* ------------------------------------------------------------------ */
/* audio feedback for wand alignment                                  */
/* ------------------------------------------------------------------ */
let actx = null;
function beep(freq = 740, dur = 0.06) {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.14, actx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + dur + 0.02);
  } catch (e) { /* audio unavailable */ }
}

/* ------------------------------------------------------------------ */
/* simulator                                                          */
/* ------------------------------------------------------------------ */
function tick() {
  if (S.connected) {
    const sp = S.settings.speed;
    const im = S.implant;
    const ch = S.ch;

    if (im.stimOn) im.soc -= (THERAPY_DRAIN_MA * TICK * sp / 3600) / im.capacity * 100;

    if (ch.on) {
      simCharge(sp);
    } else {
      ch.coilT += (25 - ch.coilT) * 0.02;
      im.temp += (36.8 - im.temp) * 0.02;
    }
    im.soc = clamp(im.soc, 0, 100);

    S.wand.battery = clamp(S.wand.battery - (ch.on ? 0.02 : 0.002) * sp / 60, 0, 100);
    S.wand.rssi = clamp(S.wand.rssi + (Math.random() - 0.5) * 1.2, -60, -40);

    if (im.soc < 8) addAlert('crit-batt', 'crit', 'Implant battery critical', 'Charge now to keep therapy running.', 120000);
    else if (im.soc < 20) addAlert('low-batt', 'warn', 'Implant battery low', 'Please charge within the next day.', 300000);
    if (S.wand.battery < 15) addAlert('wand-batt', 'warn', 'Wand battery low', 'Connect the wand to its charger.', 300000);
  }
  update();
}

function simCharge(sp) {
  const ch = S.ch;
  const im = S.implant;
  const vbat = vbatOf(im.soc);

  if (im.soc >= 99.5) { stopCharge('complete'); return; }

  ch.cycle += TICK;
  if (ch.cycle >= BURST_ON_S + BURST_GAP_S) ch.cycle = 0;

  // Telemetry gap: coil off, wand reads the implant over LF.
  if (ch.cycle >= BURST_ON_S) {
    if (ch.phase !== 'telemetry') { ch.phase = 'telemetry'; telemetryRead(); }
    ch.current = 0; ch.txV = 0; ch.rxV = 0;
    ch.hist.push(0);
    if (ch.hist.length > 480) ch.hist.shift();
    return;
  }

  const k = kOf(ch.pos);
  ch.k = k;
  const rel = ((ch.level + 1) / 37) / 0.649;          // drive relative to level 23
  const rxOpen = 42 * k * rel;                         // open-circuit receiver voltage
  let iChg = S.settings.target;                        // charger constant-current setpoint
  if (im.soc < 3) iChg = 6;                            // pre-charge
  else if (im.soc > 80) iChg = Math.max(4, S.settings.target * (100 - im.soc) / 20); // CV taper
  const linkMax = Math.max(0, (rxOpen - (vbat + 1.0)) / 0.3);
  ch.linkLimited = linkMax < iChg;

  let cur = Math.min(iChg, linkMax) * (0.97 + Math.random() * 0.06);
  cur = Math.max(0, cur);
  ch.current = cur;
  ch.rxV = Math.max(0, rxOpen - cur * 0.3);
  ch.txV = 200 * rel * (1 - 0.4 * k);
  ch.hv = 10.3 - 0.3 * rel - 0.003 * cur;
  ch.phase = k < 0.12 ? 'searching' : 'charging';
  ch.onSum += cur; ch.onN++;

  const mah = cur * TICK * sp / 3600;
  ch.sessionMah += mah;
  im.soc += mah / im.capacity * 100;

  ch.coilT += (25 + 16 * rel * rel - ch.coilT) * 0.03;
  im.temp += (36.8 + 1.7 * k * rel * (cur / 60) - im.temp) * 0.02;

  if (k < 0.12) {
    ch.lowTime += TICK;
    if (ch.lowTime > 8) addAlert('align', 'warn', 'Wand not aligned', 'No charging signal. Move the wand slowly over the implant.', 30000);
  } else ch.lowTime = 0;

  if (im.temp > 38.3) {
    addAlert('temp', 'crit', 'Implant temperature high', 'Charging power reduced automatically.', 60000);
    ch.level = Math.max(15, ch.level - 2);
  }

  ch.hist.push(cur);
  if (ch.hist.length > 480) ch.hist.shift();

  ch.beepAcc += TICK;
  const iv = k > 0.75 ? 0.25 : k > 0.45 ? 0.5 : k > 0.12 ? 1.0 : 0;
  if (S.settings.beep && iv && ch.beepAcc >= iv) { ch.beepAcc = 0; beep(k > 0.75 ? 988 : 740); }
}

function telemetryRead() {
  const ch = S.ch;
  const im = S.implant;
  const avg = ch.onN ? ch.onSum / ch.onN : 0;
  ch.onSum = 0; ch.onN = 0;

  if (Math.random() < 0.03) {
    S.stats.lfFail++;
    addLog('charging', 'Telemetry read failed (CRC) — retry at next gap');
    return;
  }
  S.stats.lfOk++;
  ch.lastTele = { t: new Date(), cur: avg, soc: im.soc, vbat: vbatOf(im.soc), temp: im.temp };
  ch.teleCount++;

  // Power tracking: raise the level only when the link is the limit,
  // lower it when the implant charger is already saturated with headroom.
  if (ch.auto && ch.k > 0.12) {
    const headroom = ch.rxV - (vbatOf(im.soc) + 1);
    if (ch.linkLimited && avg < S.settings.target * 0.92 && ch.level < 33) ch.level++;
    else if (!ch.linkLimited && headroom > 8 && ch.level > 15) ch.level--;
  }
  if (ch.teleCount % 5 === 0) {
    addLog('charging', `Telemetry: ${f(avg, 1)} mA · battery ${f(im.soc, 0)}% · level ${ch.level}`);
  }
}

function startCharge() {
  const ch = S.ch;
  if (S.imp.running) { toast('Wait for the lead test to finish', 'warn'); return; }
  ch.on = true; ch.phase = 'searching'; ch.cycle = 0; ch.sessionMah = 0;
  ch.onSum = 0; ch.onN = 0; ch.lowTime = 0; ch.startSoc = S.implant.soc;
  if (ch.auto) ch.level = 23;
  if (S.settings.beep) beep(660, 0.05);
  addLog('charging', `Charging started · battery ${f(S.implant.soc, 0)}%`);
  toast('Charging started — move the wand until the signal is strong', 'ok');
  update();
}

function stopCharge(reason = 'user') {
  const ch = S.ch;
  if (!ch.on) return;
  ch.on = false;
  ch.phase = reason === 'complete' ? 'complete' : 'idle';
  ch.current = 0; ch.txV = 0; ch.rxV = 0;
  S.implant.lastCharge = 'Today, ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  addLog('charging', `Charging ${reason === 'complete' ? 'complete' : 'stopped'} · +${f(S.implant.soc - ch.startSoc, 0)}% · ${f(ch.sessionMah, 1)} mAh delivered`);
  if (reason === 'complete') addAlert('full', 'info', 'Charging complete', 'The implant battery is full. You can remove the wand.', 5000);
  else toast('Charging stopped');
  update();
}

/* ------------------------------------------------------------------ */
/* validation of stimulation programs                                 */
/* ------------------------------------------------------------------ */
function sideCalc(L, caseAnode) {
  const cath = L.contacts.filter((c) => c === '-').length;
  const an = L.contacts.filter((c) => c === '+').length;
  const q = L.amp * L.pw / 1000;                              // µC per phase
  const dens = cath ? q / (CONTACT_AREA_CM2 * cath) : 0;      // µC/cm²
  const mode = cath === 0 ? 'Off' : an === 0 ? (caseAnode ? 'Monopolar' : '—') : 'Bipolar';
  return { cath, an, q, dens, mode };
}

function validate(p) {
  const out = [];
  if (!p.name.trim()) out.push({ type: 'err', text: 'Program name is required.' });
  for (const side of SIDES) {
    const L = p[side];
    const n = LEADS[side].name;
    const c = sideCalc(L, p.caseAnode);
    if (L.amp > 0 && c.cath === 0) out.push({ type: 'err', text: `${n}: select at least one cathode (−) or set amplitude to 0.` });
    if (c.cath > 0 && c.an === 0 && !p.caseAnode) out.push({ type: 'err', text: `${n}: add an anode (+) or enable the case as anode.` });
    if (c.cath > 0 && c.dens > DENSITY_LIMIT) out.push({ type: 'err', text: `${n}: charge density ${f(c.dens, 1)} µC/cm² exceeds the ${DENSITY_LIMIT} µC/cm² limit.` });
    else if (c.cath > 0 && c.dens > DENSITY_LIMIT * 0.66) out.push({ type: 'warn', text: `${n}: charge density ${f(c.dens, 1)} µC/cm² is close to the limit.` });
    const maxPatient = L.amp + p.offMax;
    if (maxPatient > 6) out.push({ type: 'warn', text: `${n}: patient can reach ${f(maxPatient, 1)} mA with the current limits.` });
  }
  if (!out.some((o) => o.type === 'err')) out.unshift({ type: 'ok', text: 'All parameters are within the safety limits.' });
  return out;
}

/* ------------------------------------------------------------------ */
/* view: connect                                                      */
/* ------------------------------------------------------------------ */
function viewConnect() {
  const c = S.connect;
  if (c.phase === 'connecting') {
    const steps = ['Bluetooth link to wand', 'Wand self-test', 'Implant handshake (LF 134 kHz)', 'Reading implant status'];
    return `
      <div class="connect">
        <div class="logo-big pulse">${ic('bt', 40)}</div>
        <h2>Connecting…</h2>
        <p class="lead-text">Hold the wand near the implant site.</p>
        <div class="card steps">
          ${steps.map((s, i) => `
            <div class="step ${i < c.step ? 'done' : i === c.step ? 'cur' : ''}">
              <span class="sdot">${i < c.step ? '✓' : i === c.step ? '<span class="spin"></span>' : i + 1}</span>${s}
            </div>`).join('')}
        </div>
      </div>`;
  }
  const scanning = c.phase === 'scanning';
  return `
    <div class="connect">
      <div class="logo-big ${scanning ? 'pulse' : ''}">${ic('brain', 44)}</div>
      <h2>Connect your wand</h2>
      <p class="lead-text">Turn on the SPL EIU wand and keep it within 1 m of this phone. The wand links this app to your implant.</p>
      <button class="btn primary block" data-action="scan" ${scanning ? 'disabled' : ''}>
        ${scanning ? '<span class="spin"></span> Searching for wands…' : ic('bt', 18) + ' Scan for wand'}
      </button>
      ${c.devices.map((d, i) => `
        <button class="dev" data-action="connectDev" data-arg="${i}" ${d.locked ? 'disabled' : ''}>
          <span class="dev-ic">${ic(d.locked ? 'lock' : 'bt', 20)}</span>
          <span style="flex:1">
            <b>${esc(d.name)}</b>
            <div class="small muted">${d.locked ? 'Paired to another patient' : 'Paired · this patient'} · ${d.rssi} dBm</div>
          </span>
          ${d.locked ? '' : '<span class="chip ok">Available</span>'}
        </button>`).join('')}
      <div class="features">
        <div class="feature"><b>Wireless charging</b>Live wand alignment and charge status.</div>
        <div class="feature"><b>Therapy</b>Stimulation on/off and programs.</div>
        <div class="feature"><b>Telemetry</b>Battery, temperature and current.</div>
        <div class="feature"><b>Clinician mode</b>Programming and lead tests.</div>
      </div>
      <div class="by-pace"><span>from</span><img class="on-light" src="assets/pacetronix-logo.png" alt="Pacetronix"><img class="on-dark" src="assets/pacetronix-logo-light.png" alt="" aria-hidden="true"></div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* view: patient home                                                 */
/* ------------------------------------------------------------------ */
function viewHome() {
  const p = prog();
  const recent = S.log.slice(0, 4);
  return `
    <section class="card">
      <div class="hero">
        <div class="ring-wrap">
          <svg viewBox="0 0 120 120" class="ring"><circle class="ring-bg" cx="60" cy="60" r="52"/><circle class="ring-fg" data-ring="soc" cx="60" cy="60" r="52"/></svg>
          <div class="ring-label"><div class="big"><span data-bind="socInt"></span><small>%</small></div><div class="small muted">Implant battery</div></div>
        </div>
        <div class="hero-side">
          <div><span class="chip" data-chip="batt" data-bind="battState"></span></div>
          <div class="kv"><span>Therapy left</span><b data-bind="therapyLeft"></b></div>
          <div class="kv"><span>Battery voltage</span><b><span data-bind="vbat"></span> V</b></div>
          <div class="kv"><span>Last charge</span><b data-bind="lastCharge"></b></div>
        </div>
      </div>
      <button class="btn primary block mt" data-action="tab" data-arg="charge">${ic('bolt', 18)} <span data-bind="chargeCta"></span></button>
    </section>

    <section class="card">
      <div class="stim-head">
        <div class="stim-ic">${ic('wave')}</div>
        <div style="flex:1">
          <h2>Stimulation</h2>
          <div class="small muted">Program: <b data-bind="progName"></b></div>
        </div>
        <button class="switch" data-action="toggleStim" data-on="stim" aria-label="Stimulation on or off"></button>
      </div>
      <div class="stat-row">
        <div class="stat"><div class="lbl">Left</div><div class="v"><span data-bind="ampL"></span> <small>mA</small></div></div>
        <div class="stat"><div class="lbl">Right</div><div class="v"><span data-bind="ampR"></span> <small>mA</small></div></div>
        <div class="stat"><div class="lbl">Rate</div><div class="v">${p.left.freq} <small>Hz</small></div></div>
      </div>
      <button class="btn ghost block mt" data-action="tab" data-arg="therapy">${ic('sliders', 18)} Adjust therapy</button>
    </section>

    <section class="card">
      <div class="row between"><h3>Wand</h3><span class="chip ok">Connected</span></div>
      <div class="kv mt-s"><span>Device</span><b>${esc(S.wand.name)}</b></div>
      <div class="kv"><span>Wand battery</span><b><span data-bind="wandBatt"></span>%</b></div>
      <div class="kv"><span>Bluetooth signal</span><b><span data-bind="rssi"></span> dBm</b></div>
    </section>

    <section class="card">
      <h3>Recent activity</h3>
      ${recent.length ? recent.map(logItem).join('') : '<p class="small muted mt-s">No activity yet.</p>'}
    </section>`;
}

function logItem(l) {
  return `<div class="list-item"><span class="ev-dot ${l.cat}"></span><div><div class="ev-text">${esc(l.text)}</div><div class="ev-time">${tstr(l.t)} · ${l.cat}</div></div></div>`;
}

/* ------------------------------------------------------------------ */
/* view: charging (patient + clinician)                               */
/* ------------------------------------------------------------------ */
function metric(label, bind, unit) {
  return `<div class="metric"><div class="lbl">${label}</div><div class="val"><span data-bind="${bind}"></span><span class="unit">${unit}</span></div></div>`;
}

function viewCharge() {
  const clin = S.role === 'clinician';
  return `
    <section class="card">
      <div class="row between"><h2>Wireless charging</h2><span class="chip" data-chip="phase" data-bind="chPhase"></span></div>
      <div class="align">
        <div class="bars" id="bars"><i></i><i></i><i></i><i></i><i></i></div>
        <div><div class="align-title" data-bind="alignTitle"></div><div class="small muted" data-bind="alignHint"></div></div>
      </div>
      <div class="pad" id="pad">
        <div class="pad-body"></div>
        <div class="pad-target"></div>
        <div class="pad-label">implant (hidden)</div>
        <div class="wand-dot" id="wandDot">WAND</div>
      </div>
      <p class="note">Demo simulator: drag the wand over the chest. In the real system the signal comes from implant telemetry, the patient cannot see the implant.</p>
      <div class="cycle"><div class="cycle-bar"><div class="cycle-fill" id="cycleFill"></div></div><span data-bind="cycleLabel"></span></div>
      <button class="btn primary block" data-action="toggleCharge" data-on="charging">${ic('bolt', 18)} <span data-bind="chBtn"></span></button>
    </section>

    <div class="grid2">
      ${metric('Charge current', 'chCurrent', 'mA')}
      ${metric('Implant battery', 'soc1', '%')}
      ${metric('Time to full', 'eta', '')}
      ${metric('Implant temp', 'implT', '°C')}
      ${clin ? metric('Receiver voltage', 'rxV', 'V') : ''}
      ${clin ? metric('Tx coil voltage', 'txV', 'Vpk') : ''}
      ${clin ? metric('Power level', 'levelTxt', '') : ''}
      ${clin ? metric('Coil temp', 'coilT', '°C') : ''}
    </div>

    <section class="card">
      <div class="row between"><h3>Charge current</h3><span class="small muted">last 2 min (demo time)</span></div>
      <canvas class="chart" id="chart"></canvas>
    </section>

    ${clin ? `
    <section class="card">
      <div class="row between"><h3>Power control</h3><span class="small muted">Engineering</span></div>
      <div class="set-row">
        <div><div class="t1">Automatic power tracking</div><div class="t2">Adjusts coil drive from implant telemetry each gap</div></div>
        <button class="switch" data-action="toggleAuto" data-on="auto"></button>
      </div>
      <div class="set-row" data-show="manual">
        <div><div class="t1">Manual power level</div><div class="t2">pwm-rail duty, 15–33</div></div>
        <div class="row"><button class="btn sm" data-action="levelAdj" data-arg="-1">−</button><b class="num" data-bind="level"></b><button class="btn sm" data-action="levelAdj" data-arg="1">+</button></div>
      </div>
      <div class="field mt">
        <label>Implant charge current limit <b><span data-val="set.target">${S.settings.target}</span> mA</b></label>
        <input type="range" min="20" max="60" step="5" value="${S.settings.target}" data-input="set.target">
      </div>
      <div class="kv mt"><span>HV rail</span><b><span data-bind="hv"></span> V</b></div>
      <div class="kv"><span>Coil drive</span><b>${S.wand.drive} · open loop until telemetry</b></div>
      <div class="kv"><span>Last telemetry</span><b data-bind="lastTele"></b></div>
      <div class="kv"><span>Delivered this session</span><b><span data-bind="sessionMah"></span> mAh</b></div>
    </section>` : `
    <section class="card">
      <h3>Charging tips</h3>
      <div class="kv mt-s"><span>1</span><b style="text-align:left;flex:1;font-weight:500">Sit upright and place the wand over the implant.</b></div>
      <div class="kv"><span>2</span><b style="text-align:left;flex:1;font-weight:500">Move slowly until the beeps are fast and the bars are green.</b></div>
      <div class="kv"><span>3</span><b style="text-align:left;flex:1;font-weight:500">Keep still. The app tells you when charging is complete.</b></div>
    </section>`}`;
}

/* ------------------------------------------------------------------ */
/* view: patient therapy                                              */
/* ------------------------------------------------------------------ */
function viewTherapy() {
  const p = prog();
  return `
    <section class="card">
      <div class="stim-head">
        <div class="stim-ic">${ic('power')}</div>
        <div style="flex:1"><h2>Stimulation <span data-bind="stimState"></span></h2><div class="small muted">Both leads</div></div>
        <button class="switch" data-action="toggleStim" data-on="stim"></button>
      </div>
    </section>

    <div class="section-title">Programs</div>
    ${S.programs.map((q, i) => `
      <button class="prog ${i === S.active ? 'active' : ''}" data-action="selectProg" data-arg="${i}">
        <span class="radio"></span>
        <span style="flex:1">
          <div class="prog-name">${esc(q.name)}</div>
          <div class="small muted">${esc(q.desc)} · ${q.left.freq} Hz · ${q.left.pw} µs</div>
        </span>
      </button>`).join('')}

    <div class="section-title">Amplitude adjustment</div>
    <section class="card">
      <div class="adj">
        <button class="btn round" data-action="adj" data-arg="-1" aria-label="Decrease">−</button>
        <div class="adj-val"><div class="big" data-bind="offset"></div><div class="small muted">from clinician setting</div></div>
        <button class="btn round" data-action="adj" data-arg="1" aria-label="Increase">+</button>
      </div>
      <div class="limit"><div class="mark" data-mark="offset"></div></div>
      <div class="limit-scale"><span>${signed(p.offMin)} mA</span><span>Limits set by your clinician</span><span>${signed(p.offMax)} mA</span></div>
      <div class="stat-row">
        <div class="stat"><div class="lbl">Left</div><div class="v"><span data-bind="ampL"></span> <small>mA</small></div></div>
        <div class="stat"><div class="lbl">Right</div><div class="v"><span data-bind="ampR"></span> <small>mA</small></div></div>
        <div class="stat"><div class="lbl">Pulse</div><div class="v">${p.left.pw} <small>µs</small></div></div>
      </div>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* view: alerts                                                       */
/* ------------------------------------------------------------------ */
function viewAlerts() {
  if (!S.alerts.length) {
    return `<div class="empty"><div class="ic">${ic('check', 28)}</div><h3>All clear</h3><p class="small mt-s">Battery, charging and implant warnings appear here.</p></div>`;
  }
  const icons = { warn: 'alert', crit: 'alert', info: 'info', ok: 'check' };
  return `
    <div class="row between" style="margin:0 4px 10px"><h2>Alerts</h2><button class="btn sm ghost" data-action="clearAlerts">Clear</button></div>
    ${S.alerts.map((a) => `
      <div class="alert ${a.sev}">
        <div class="alert-ic">${ic(icons[a.sev] || 'info', 18)}</div>
        <div><b>${esc(a.title)}</b><p>${esc(a.text)}</p><div class="ev-time">${tstr(a.t)}</div></div>
      </div>`).join('')}`;
}

/* ------------------------------------------------------------------ */
/* view: clinician programming                                        */
/* ------------------------------------------------------------------ */
function viewProgram() {
  if (!S.edit) {
    if (S.editIdx >= S.programs.length) S.editIdx = S.active;
    S.edit = deep(S.programs[S.editIdx]);
  }
  const e = S.edit;
  const isNew = S.editIdx >= S.programs.length;
  return `
    <section class="card">
      <div class="row between"><h2>Stimulation programming</h2><span class="chip ${S.implant.stimOn ? 'ok' : 'warn'}">Stim ${S.implant.stimOn ? 'ON' : 'OFF'}</span></div>
      <div class="row mt">
        <select data-input="editSelect" style="flex:1">
          ${S.programs.map((q, i) => `<option value="${i}" ${i === S.editIdx ? 'selected' : ''}>${esc(q.name)}${i === S.active ? ' (active)' : ''}</option>`).join('')}
          ${isNew ? `<option value="${S.editIdx}" selected>New program (unsaved)</option>` : ''}
        </select>
        <button class="btn sm" data-action="newProg">${ic('plus', 16)} New</button>
      </div>
      <div class="field mt"><label>Program name</label><input type="text" value="${esc(e.name)}" maxlength="24" data-input="name"></div>
      <div class="field mt"><label>Description</label><input type="text" value="${esc(e.desc)}" maxlength="48" data-input="desc"></div>
    </section>

    ${SIDES.map((side) => leadEditor(side, e)).join('')}

    <section class="card">
      <div class="set-row">
        <div><div class="t1">Case (IPG can) as anode</div><div class="t2">Monopolar stimulation</div></div>
        <button class="switch ${e.caseAnode ? 'on' : ''}" data-action="toggleCase"></button>
      </div>
      <div class="section-title" style="margin-left:0">Patient adjustment limits</div>
      <div class="field">
        <label>Lowest patient offset <b><span data-val="offMin">${signed(e.offMin)}</span> mA</b></label>
        <input type="range" min="-2" max="0" step="0.1" value="${e.offMin}" data-input="offMin">
      </div>
      <div class="field mt">
        <label>Highest patient offset <b><span data-val="offMax">${signed(e.offMax)}</span> mA</b></label>
        <input type="range" min="0" max="2" step="0.1" value="${e.offMax}" data-input="offMax">
      </div>
    </section>

    <section class="card">
      <h3>Safety check</h3>
      <div id="validation">${validationHtml()}</div>
      <div class="btn-row mt">
        <button class="btn ghost" data-action="revertEdit">${ic('refresh', 16)} Revert</button>
        <button class="btn primary" data-action="sendProg">${ic('bt', 16)} Send to implant</button>
      </div>
    </section>`;
}

function leadEditor(side, e) {
  const L = e[side];
  const order = [3, 2, 1, 0];
  const cls = { off: '', '-': 'neg', '+': 'pos' };
  return `
    <section class="card">
      <div class="row between"><h3>${LEADS[side].name}</h3><span class="small muted" data-calc="${side}.mode"></span></div>
      <div class="lead-card mt">
        <div class="lead">
          <div class="lead-wire"></div>
          <div class="lead-body">
            ${order.map((i) => `<button class="contact ${cls[L.contacts[i]]}" data-action="cycleContact" data-arg="${side}:${i}" title="Tap to cycle off → cathode → anode">${LEADS[side].labels[i]}${L.contacts[i] === 'off' ? '' : L.contacts[i] === '-' ? '−' : '+'}</button>`).join('')}
          </div>
          <div class="lead-tip"></div>
          <div class="lead-name">distal ↓</div>
        </div>
        <div class="params">
          <div class="field">
            <label>Amplitude <b><span data-val="${side}.amp">${f(L.amp, 1)}</span> mA</b></label>
            <input type="range" min="0" max="10" step="0.1" value="${L.amp}" data-input="${side}.amp">
          </div>
          <div class="field">
            <label>Pulse width <b><span data-val="${side}.pw">${L.pw}</span> µs</b></label>
            <input type="range" min="30" max="450" step="10" value="${L.pw}" data-input="${side}.pw">
          </div>
          <div class="field">
            <label>Frequency <b><span data-val="${side}.freq">${L.freq}</span> Hz</b></label>
            <input type="range" min="2" max="250" step="1" value="${L.freq}" data-input="${side}.freq">
          </div>
        </div>
      </div>
      <div class="calc">
        <div class="stat"><div class="lbl">Charge / phase</div><div class="v"><span data-calc="${side}.q"></span> <small>µC</small></div></div>
        <div class="stat"><div class="lbl">Charge density</div><div class="v"><span data-calc="${side}.dens"></span> <small>µC/cm²</small></div></div>
      </div>
      <div class="legend"><span><i style="background:var(--cathode)"></i>Cathode (−)</span><span><i style="background:var(--anode)"></i>Anode (+)</span><span>Tap a contact to cycle</span></div>
    </section>`;
}

function validationHtml() {
  const icon = { err: 'x', warn: 'alert', ok: 'check' };
  return validate(S.edit).map((m) => `<div class="msg ${m.type}">${ic(icon[m.type], 16)}<span>${esc(m.text)}</span></div>`).join('');
}

function refreshEdit() {
  const v = $('#validation');
  if (v) v.innerHTML = validationHtml();
  for (const side of SIDES) {
    const c = sideCalc(S.edit[side], S.edit.caseAnode);
    const set = (k, val) => { const el = $(`[data-calc="${side}.${k}"]`); if (el) el.textContent = val; };
    set('mode', c.mode + (c.cath ? ` · ${c.cath} cathode${c.cath > 1 ? 's' : ''}` : ''));
    set('q', f(c.q, 3));
    set('dens', f(c.dens, 1));
  }
}

/* ------------------------------------------------------------------ */
/* view: clinician lead impedance                                     */
/* ------------------------------------------------------------------ */
function impStatus(ohm) {
  if (ohm < 250) return { label: 'Short', cls: 'crit' };
  if (ohm > 4000) return { label: 'Open', cls: 'crit' };
  if (ohm > 2500) return { label: 'High', cls: 'warn' };
  return { label: 'Normal', cls: 'ok' };
}

function viewImpedance() {
  const im = S.imp;
  return `
    <section class="card">
      <h2>Lead impedance test</h2>
      <p class="small muted mt-s">Sends a short sub-threshold pulse through each contact and measures the return. Charging pauses during the test.</p>
      <button class="btn primary block mt" data-action="runImp" ${im.running ? 'disabled' : ''}>${ic('activity', 18)} ${im.running ? 'Testing…' : 'Run test'}</button>
      <div data-show="impRunning" class="mt"><div class="progress"><div id="impBar"></div></div><div class="small muted mt-s">Measuring contacts… <span data-bind="impProg"></span></div></div>
    </section>
    ${im.results ? SIDES.map((side) => `
      <section class="card">
        <div class="row between"><h3>${LEADS[side].name}</h3><span class="small muted">${tstr(im.at)}</span></div>
        <table class="t mt-s">
          <tr><th>Contact</th><th>Impedance</th><th>Status</th></tr>
          ${im.results[side].map((ohm, i) => { const s = impStatus(ohm); return `<tr><td>E${LEADS[side].labels[i]}</td><td>${ohm} Ω</td><td><span class="chip ${s.cls}">${s.label}</span></td></tr>`; }).join('')}
        </table>
      </section>`).join('') : ''}
    <section class="card">
      <h3>Reference ranges</h3>
      <div class="kv mt-s"><span>Normal</span><b>250 – 2500 Ω</b></div>
      <div class="kv"><span>High (check lead)</span><b>2500 – 4000 Ω</b></div>
      <div class="kv"><span>Open circuit</span><b>&gt; 4000 Ω</b></div>
      <div class="kv"><span>Short circuit</span><b>&lt; 250 Ω</b></div>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* view: clinician device info                                        */
/* ------------------------------------------------------------------ */
function viewDevice() {
  const im = S.implant;
  const w = S.wand;
  return `
    <section class="card">
      <div class="row between"><h2>Implant</h2><button class="btn sm ghost" data-action="readStatus">${ic('refresh', 16)} Read</button></div>
      <div class="kv mt-s"><span>Model</span><b>${esc(im.model)}</b></div>
      <div class="kv"><span>Serial</span><b>${esc(im.serial)}</b></div>
      <div class="kv"><span>Firmware</span><b>${esc(im.fw)}</b></div>
      <div class="kv"><span>Battery</span><b><span data-bind="soc1"></span>% · <span data-bind="vbat"></span> V</b></div>
      <div class="kv"><span>Capacity</span><b>${im.capacity} mAh · health ${im.health}%</b></div>
      <div class="kv"><span>Charge cycles</span><b>${im.cycles}</b></div>
      <div class="kv"><span>Temperature</span><b><span data-bind="implT"></span> °C</b></div>
      <div class="kv"><span>Stimulation</span><b data-bind="stimState"></b></div>
      <div class="kv"><span>Active program</span><b data-bind="progName"></b></div>
    </section>
    <section class="card">
      <h2>Wand (EIU)</h2>
      <div class="kv mt-s"><span>Name</span><b>${esc(w.name)}</b></div>
      <div class="kv"><span>Hardware</span><b>${esc(w.hw)}</b></div>
      <div class="kv"><span>Firmware</span><b>${esc(w.fw)}</b></div>
      <div class="kv"><span>Wand battery</span><b><span data-bind="wandBatt"></span>%</b></div>
      <div class="kv"><span>Bluetooth</span><b><span data-bind="rssi"></span> dBm</b></div>
      <div class="kv"><span>HV rail set-point</span><b>${f(w.hv, 1)} V</b></div>
      <div class="kv"><span>Coil drive</span><b>${w.drive}</b></div>
      <div class="kv"><span>Power level range</span><b>15 – 33</b></div>
    </section>
    <section class="card">
      <h2>Link statistics</h2>
      <div class="kv mt-s"><span>Connected since</span><b>${S.stats.since ? tstr(S.stats.since) : '—'}</b></div>
      <div class="kv"><span>LF telemetry reads OK</span><b data-bind="lfOk"></b></div>
      <div class="kv"><span>LF reads failed (CRC)</span><b data-bind="lfFail"></b></div>
    </section>
    <section class="card">
      <h2>Manufacturer</h2>
      <div class="by-pace"><img class="on-light" src="assets/pacetronix-logo.png" alt="Pacetronix"><img class="on-dark" src="assets/pacetronix-logo-light.png" alt="" aria-hidden="true"></div>
      <div class="kv mt-s"><span>Company</span><b>Shree Pacetronix Ltd.</b></div>
      <div class="kv"><span>Site</span><b>Pithampur, MP, India</b></div>
      <div class="kv"><span>Quality system</span><b>ISO 9001</b></div>
      <div class="kv"><span>App</span><b>SPL EIU Companion · demo 0.1</b></div>
      <p class="note mt">Demo build. All implant and wand data on these screens is simulated.</p>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* view: clinician log                                                */
/* ------------------------------------------------------------------ */
function viewLog() {
  const cats = [['all', 'All'], ['therapy', 'Therapy'], ['charging', 'Charging'], ['system', 'System']];
  const rows = S.log.filter((l) => S.logFilter === 'all' || l.cat === S.logFilter);
  return `
    <section class="card">
      <div class="row between"><h2>Session log</h2><span class="small muted">${S.log.length} events</span></div>
      <div class="seg mt">${cats.map(([k, n]) => `<button class="${S.logFilter === k ? 'active' : ''}" data-action="logFilter" data-arg="${k}">${n}</button>`).join('')}</div>
      <div class="btn-row mt">
        <button class="btn sm" data-action="exportCsv">${ic('download', 16)} Export CSV</button>
        <button class="btn sm ghost" data-action="clearLog">Clear log</button>
      </div>
    </section>
    <section class="card">
      ${rows.length ? rows.slice(0, 120).map(logItem).join('') : '<p class="small muted">No events.</p>'}
    </section>`;
}

/* ------------------------------------------------------------------ */
/* navigation / render                                                */
/* ------------------------------------------------------------------ */
const TABS = {
  patient: [['home', 'Home', 'home'], ['charge', 'Charge', 'bolt'], ['therapy', 'Therapy', 'sliders'], ['alerts', 'Alerts', 'bell']],
  clinician: [['program', 'Program', 'sliders'], ['impedance', 'Leads', 'activity'], ['charge', 'Charge', 'bolt'], ['device', 'Device', 'cpu'], ['log', 'Log', 'list']],
};
const VIEWS = {
  home: viewHome, charge: viewCharge, therapy: viewTherapy, alerts: viewAlerts,
  program: viewProgram, impedance: viewImpedance, device: viewDevice, log: viewLog,
};

function render() {
  const view = $('#view');
  const tabbar = $('#tabbar');
  if (!S.connected) {
    view.innerHTML = viewConnect();
    tabbar.hidden = true;
  } else {
    const tabs = TABS[S.role];
    if (!tabs.some((t) => t[0] === S.tab)) S.tab = tabs[0][0];
    if (S.tab === 'alerts') S.unread = 0;
    view.innerHTML = VIEWS[S.tab]();
    tabbar.hidden = false;
    tabbar.innerHTML = tabs.map(([k, n, i]) => `
      <button class="tab ${S.tab === k ? 'active' : ''}" data-action="tab" data-arg="${k}">
        <span class="tab-ic">${ic(i)}</span>${n}
        ${k === 'alerts' ? '<span class="badge" data-bind="unread" data-show="hasUnread"></span>' : ''}
      </button>`).join('');
  }
  bindPad();
  if (S.tab === 'program' && S.connected) refreshEdit();
  update();
}

function goTab(t) {
  S.tab = t;
  render();
  $('#view').scrollTop = 0;
}

/* ------------------------------------------------------------------ */
/* live bindings, refreshed every tick                                */
/* ------------------------------------------------------------------ */
function battInfo() {
  const s = S.implant.soc;
  if (S.ch.on) return { label: 'Charging', cls: 'info' };
  if (s < 10) return { label: 'Critical', cls: 'crit' };
  if (s < 25) return { label: 'Low', cls: 'warn' };
  return { label: 'Good', cls: 'ok' };
}

function barCount() {
  if (!S.ch.on || S.ch.phase === 'telemetry') return S.ch.on ? S.ch.lastBars || 0 : 0;
  const k = S.ch.k;
  const n = k > 0.85 ? 5 : k > 0.65 ? 4 : k > 0.45 ? 3 : k > 0.25 ? 2 : k > 0.12 ? 1 : 0;
  S.ch.lastBars = n;
  return n;
}

const BIND = {
  roleLabel: () => (S.role === 'clinician' ? 'Clinician mode' : 'Patient mode'),
  connPill: () => (S.connected ? 'Connected' : 'Offline'),
  socInt: () => f(S.implant.soc, 0),
  soc1: () => f(S.implant.soc, 1),
  vbat: () => f(vbatOf(S.implant.soc), 2),
  battState: () => battInfo().label,
  therapyLeft: () => {
    const h = S.implant.soc / 100 * S.implant.capacity / THERAPY_DRAIN_MA;
    return h > 48 ? `≈ ${f(h / 24, 1)} days` : `≈ ${f(h, 0)} h`;
  },
  lastCharge: () => S.implant.lastCharge,
  chargeCta: () => (S.ch.on ? 'Charging… view status' : 'Charge now'),
  stimState: () => (S.implant.stimOn ? 'ON' : 'OFF'),
  progName: () => prog().name,
  ampL: () => f(ampEff(prog(), 'left'), 1),
  ampR: () => f(ampEff(prog(), 'right'), 1),
  offset: () => signed(prog().offset) + ' mA',
  wandBatt: () => f(S.wand.battery, 0),
  rssi: () => f(S.wand.rssi, 0),
  chPhase: () => PHASE[S.ch.phase].label,
  alignTitle: () => {
    if (!S.ch.on) return S.ch.phase === 'complete' ? 'Charging complete' : 'Ready to charge';
    const n = barCount();
    return ['No signal', 'Weak signal', 'Weak signal', 'Good position', 'Very good', 'Excellent — hold here'][n];
  },
  alignHint: () => {
    if (!S.ch.on) return S.ch.phase === 'complete' ? 'You can remove the wand.' : 'Place the wand over the implant and press Start.';
    const n = barCount();
    return n === 0 ? 'Move the wand slowly across the implant area.' : n < 3 ? 'Keep moving slowly — the signal is getting stronger.' : n < 5 ? 'Almost there — small movements only.' : 'Keep the wand still until charging finishes.';
  },
  cycleLabel: () => (!S.ch.on ? 'Coil off' : S.ch.phase === 'telemetry' ? 'Reading implant telemetry…' : `Power burst · ${f(BURST_ON_S - S.ch.cycle, 0)} s to telemetry`),
  chBtn: () => (S.ch.on ? 'Stop charging' : 'Start charging'),
  chCurrent: () => f(S.ch.current, 1),
  rxV: () => f(S.ch.rxV, 1),
  txV: () => f(S.ch.txV, 0),
  hv: () => f(S.ch.on ? S.ch.hv : S.wand.hv, 2),
  level: () => String(S.ch.level),
  levelTxt: () => `${S.ch.level} · ${f((S.ch.level + 1) / 37 * 100, 0)}%`,
  coilT: () => f(S.ch.coilT, 1),
  implT: () => f(S.implant.temp, 1),
  eta: () => {
    if (!S.ch.on) return '—';
    const cur = Math.max(S.ch.lastTele ? S.ch.lastTele.cur : 0, S.ch.current);
    if (cur < 1) return '—';
    const rem = (100 - S.implant.soc) / 100 * S.implant.capacity;
    const h = rem / cur * 1.15;
    const tot = Math.round(h * 60);
    return tot < 60 ? `${tot} min` : `${Math.floor(tot / 60)} h ${tot % 60} m`;
  },
  lastTele: () => (S.ch.lastTele ? `${tstr(S.ch.lastTele.t)} · ${f(S.ch.lastTele.cur, 1)} mA` : '—'),
  sessionMah: () => f(S.ch.sessionMah, 1),
  unread: () => (S.unread > 9 ? '9+' : String(S.unread)),
  impProg: () => f(S.imp.progress, 0) + '%',
  lfOk: () => String(S.stats.lfOk),
  lfFail: () => String(S.stats.lfFail),
};
const ON = {
  stim: () => S.implant.stimOn,
  charging: () => S.ch.on,
  auto: () => S.ch.auto,
};
const CHIP = {
  batt: () => battInfo().cls,
  phase: () => PHASE[S.ch.phase].cls,
  conn: () => (S.connected ? 'ok' : 'warn'),
};
const SHOW = {
  hasUnread: () => S.unread > 0,
  manual: () => !S.ch.auto,
  impRunning: () => S.imp.running,
};

function update() {
  $$('[data-bind]').forEach((el) => {
    const fn = BIND[el.dataset.bind];
    if (fn) { const v = fn(); if (el.textContent !== v) el.textContent = v; }
  });
  $$('[data-on]').forEach((el) => el.classList.toggle('on', !!ON[el.dataset.on]()));
  $$('[data-chip]').forEach((el) => {
    const base = el.classList.contains('pill') ? 'pill' : 'chip';
    el.className = `${base} ${CHIP[el.dataset.chip]()}`;
  });
  $$('[data-show]').forEach((el) => { el.hidden = !SHOW[el.dataset.show](); });

  $$('[data-ring]').forEach((el) => {
    const soc = S.implant.soc;
    el.style.strokeDashoffset = String(326.73 * (1 - soc / 100));
    el.setAttribute('class', 'ring-fg ' + (S.ch.on ? 'info' : soc < 10 ? 'crit' : soc < 25 ? 'warn' : ''));
  });
  $$('[data-mark]').forEach((el) => {
    const p = prog();
    const span = p.offMax - p.offMin || 1;
    el.style.left = ((p.offset - p.offMin) / span * 100) + '%';
  });

  const dot = $('#wandDot');
  if (dot) {
    dot.style.left = ((S.ch.pos.x + 1) / 2 * 100) + '%';
    dot.style.top = ((S.ch.pos.y + 1) / 2 * 100) + '%';
  }
  const bars = $('#bars');
  if (bars) {
    const n = barCount();
    $$('i', bars).forEach((b, i) => b.classList.toggle('lit', i < n));
    bars.className = 'bars ' + (n >= 4 ? 'good' : n > 0 && n <= 2 ? 'weak' : '');
  }
  const fill = $('#cycleFill');
  if (fill) {
    const tele = S.ch.on && S.ch.phase === 'telemetry';
    fill.classList.toggle('tele', tele);
    fill.style.width = !S.ch.on ? '0%' : tele ? '100%' : (S.ch.cycle / BURST_ON_S * 100) + '%';
  }
  const ib = $('#impBar');
  if (ib) ib.style.width = S.imp.progress + '%';

  drawChart();
}

function drawChart() {
  const c = $('#chart');
  if (!c) return;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const cs = getComputedStyle(document.documentElement);
  const line = cs.getPropertyValue('--line').trim();
  const brand = cs.getPropertyValue('--brand').trim();
  const muted = cs.getPropertyValue('--muted').trim();
  const warn = cs.getPropertyValue('--warn').trim();
  const max = 70;
  const left = 24;
  const yOf = (v) => h - 10 - (v / max) * (h - 20);

  g.font = '10px system-ui, sans-serif';
  g.lineWidth = 1;
  for (const v of [0, 20, 40, 60]) {
    const y = yOf(v);
    g.strokeStyle = line;
    g.beginPath(); g.moveTo(left, y); g.lineTo(w, y); g.stroke();
    g.fillStyle = muted;
    g.fillText(String(v), 0, y + 3);
  }
  if (S.role === 'clinician') {
    g.setLineDash([4, 4]);
    g.strokeStyle = warn;
    g.beginPath(); g.moveTo(left, yOf(S.settings.target)); g.lineTo(w, yOf(S.settings.target)); g.stroke();
    g.setLineDash([]);
  }

  const d = S.ch.hist;
  if (d.length < 2) return;
  const n = 480;
  const xOf = (i) => left + (i + (n - d.length)) / (n - 1) * (w - left);
  g.beginPath();
  d.forEach((v, i) => { const x = xOf(i); const y = yOf(v); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
  g.strokeStyle = brand;
  g.lineWidth = 2;
  g.stroke();
  g.lineTo(xOf(d.length - 1), yOf(0));
  g.lineTo(xOf(0), yOf(0));
  g.closePath();
  g.globalAlpha = 0.12;
  g.fillStyle = brand;
  g.fill();
  g.globalAlpha = 1;
}

function bindPad() {
  const pad = $('#pad');
  if (!pad) return;
  let drag = false;
  const move = (e) => {
    const r = pad.getBoundingClientRect();
    S.ch.pos = {
      x: clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1),
      y: clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1),
    };
    update();
  };
  pad.addEventListener('pointerdown', (e) => { drag = true; pad.setPointerCapture(e.pointerId); move(e); });
  pad.addEventListener('pointermove', (e) => { if (drag) move(e); });
  pad.addEventListener('pointerup', () => { drag = false; });
  pad.addEventListener('pointercancel', () => { drag = false; });
}

/* ------------------------------------------------------------------ */
/* modals                                                             */
/* ------------------------------------------------------------------ */
let modalKind = null;
let modalOk = null;
let pinBuf = '';

function openModal(kind, html) {
  modalKind = kind;
  $('#modal-root').innerHTML = `<div class="scrim" data-action="scrim"><div class="sheet"><div class="sheet-handle"></div>${html}</div></div>`;
  update();
}
function closeModal() {
  modalKind = null;
  modalOk = null;
  $('#modal-root').innerHTML = '';
}
function confirmModal(title, body, okLabel, onOk, danger = false) {
  modalOk = onOk;
  openModal('confirm', `
    <h2>${esc(title)}</h2>
    <p class="lead-text">${body}</p>
    <div class="btn-row">
      <button class="btn ghost" data-action="closeModal">Cancel</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-action="modalOk">${esc(okLabel)}</button>
    </div>`);
}

function settingsHtml() {
  const clin = S.role === 'clinician';
  return `
    <h2>Settings</h2>
    <div class="section-title" style="margin-left:0">Mode</div>
    <div class="seg">
      <button class="${!clin ? 'active' : ''}" data-action="setRole" data-arg="patient">Patient</button>
      <button class="${clin ? 'active' : ''}" data-action="setRole" data-arg="clinician">${ic('lock', 14)} Clinician</button>
    </div>
    <div class="section-title" style="margin-left:0">Charging</div>
    <div class="set-row">
      <div><div class="t1">Alignment beeps</div><div class="t2">Faster beeps = better wand position</div></div>
      <button class="switch ${S.settings.beep ? 'on' : ''}" data-action="toggleBeep"></button>
    </div>
    <div class="set-row">
      <div><div class="t1">Automatic power tracking</div><div class="t2">Wand adjusts coil power from telemetry</div></div>
      <button class="switch ${S.ch.auto ? 'on' : ''}" data-action="toggleAuto"></button>
    </div>
    <div class="section-title" style="margin-left:0">Demo</div>
    <div class="set-row">
      <div><div class="t1">Simulation speed</div><div class="t2">How fast demo time passes</div></div>
    </div>
    <div class="seg">${[1, 10, 60].map((s) => `<button class="${S.settings.speed === s ? 'active' : ''}" data-action="speed" data-arg="${s}">${s}×</button>`).join('')}</div>
    <div class="btn-row mt">
      ${S.connected ? `<button class="btn ghost" data-action="disconnect">${ic('bt', 16)} Disconnect</button>` : ''}
      <button class="btn ghost" data-action="resetDemo">${ic('refresh', 16)} Reset demo</button>
    </div>
    <p class="note mt">SPL EIU Companion · demo build 0.1 · all device data is simulated. Not a medical device and not for clinical use.</p>
    <div class="by-pace"><img class="on-light" src="assets/pacetronix-logo.png" alt="Pacetronix"><img class="on-dark" src="assets/pacetronix-logo-light.png" alt="" aria-hidden="true"></div>
    <button class="btn primary block" data-action="closeModal">Done</button>`;
}

function pinHtml() {
  return `
    <h2>Clinician sign-in</h2>
    <p class="lead-text">Enter the clinician PIN to unlock programming. <b>Demo PIN: ${CLIN_PIN}</b></p>
    <div class="pin-dots" id="pinDots">${[0, 1, 2, 3].map((i) => `<i class="${i < pinBuf.length ? 'f' : ''}"></i>`).join('')}</div>
    <div class="keypad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="btn" data-action="pinKey" data-arg="${n}">${n}</button>`).join('')}
      <button class="btn ghost" data-action="closeModal">Cancel</button>
      <button class="btn" data-action="pinKey" data-arg="0">0</button>
      <button class="btn ghost" data-action="pinDel">⌫</button>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* actions                                                            */
/* ------------------------------------------------------------------ */
const ACTIONS = {
  scrim(arg, e) { if (e.target.classList.contains('scrim')) closeModal(); },
  closeModal,
  modalOk() { const fn = modalOk; closeModal(); if (fn) fn(); },

  scan() {
    S.connect = { phase: 'scanning', devices: [], step: 0 };
    render();
    setTimeout(() => { S.connect.devices.push({ name: 'SPL-EIU-0421', rssi: -48 }); render(); }, 700);
    setTimeout(() => { S.connect.devices.push({ name: 'SPL-EIU-0388', rssi: -81, locked: true }); render(); }, 1300);
    setTimeout(() => { S.connect.phase = 'list'; render(); }, 1600);
  },
  connectDev() {
    S.connect.phase = 'connecting';
    S.connect.step = 0;
    render();
    const next = () => {
      S.connect.step++;
      if (S.connect.step < 4) { render(); setTimeout(next, 650); return; }
      S.connected = true;
      S.stats.since = new Date();
      S.tab = S.role === 'clinician' ? 'program' : 'home';
      addLog('system', `Connected to ${S.wand.name} · implant ${S.implant.serial}`);
      render();
      toast('Wand connected · implant found', 'ok');
    };
    setTimeout(next, 650);
  },

  tab(arg) { goTab(arg); },
  settings() { openModal('settings', settingsHtml()); },

  toggleStim() {
    const im = S.implant;
    if (im.stimOn) {
      confirmModal('Turn stimulation off?', 'Symptoms may return within minutes. You can turn stimulation back on at any time.', 'Turn off', () => {
        im.stimOn = false;
        addLog('therapy', 'Stimulation turned OFF');
        toast('Stimulation off', 'warn');
        render();
      }, true);
    } else {
      im.stimOn = true;
      addLog('therapy', `Stimulation ON · ${prog().name}`);
      toast('Stimulation on — ramping up over 5 s', 'ok');
      render();
    }
  },

  toggleCharge() { if (S.ch.on) stopCharge('user'); else startCharge(); },
  toggleAuto() {
    S.ch.auto = !S.ch.auto;
    addLog('charging', `Automatic power tracking ${S.ch.auto ? 'enabled' : 'disabled'}`);
    if (modalKind === 'settings') openModal('settings', settingsHtml());
    update();
  },
  levelAdj(arg) { S.ch.level = clamp(S.ch.level + Number(arg), 15, 33); addLog('charging', `Manual power level ${S.ch.level}`); update(); },

  selectProg(arg) {
    const i = Number(arg);
    if (i === S.active) return;
    S.active = i;
    addLog('therapy', `Program changed to ${prog().name}`);
    toast(`${prog().name} sent to implant ✓`, 'ok');
    render();
  },
  adj(arg) {
    const p = prog();
    const next = clamp(r1(p.offset + Number(arg) * 0.1), p.offMin, p.offMax);
    if (next === p.offset) { toast('Limit reached — set by your clinician', 'warn'); return; }
    p.offset = next;
    addLog('therapy', `Amplitude adjusted ${signed(next)} mA (${p.name})`);
    update();
  },
  clearAlerts() { S.alerts = []; S.unread = 0; render(); },

  setRole(arg) {
    if (arg === S.role) return;
    if (arg === 'patient') {
      S.role = 'patient';
      S.edit = null;
      addLog('system', 'Switched to patient mode');
      closeModal();
      render();
      return;
    }
    pinBuf = '';
    openModal('pin', pinHtml());
  },
  pinKey(arg) {
    if (pinBuf.length >= 4) return;
    pinBuf += arg;
    openModal('pin', pinHtml());
    if (pinBuf.length === 4) {
      if (pinBuf === CLIN_PIN) {
        S.role = 'clinician';
        S.tab = 'program';
        addLog('system', 'Clinician signed in');
        closeModal();
        render();
        toast('Clinician mode unlocked', 'ok');
      } else {
        const dots = $('#pinDots');
        if (dots) dots.classList.add('shake');
        setTimeout(() => { pinBuf = ''; if (modalKind === 'pin') openModal('pin', pinHtml()); }, 400);
        toast('Incorrect PIN', 'crit');
      }
    }
  },
  pinDel() { pinBuf = pinBuf.slice(0, -1); openModal('pin', pinHtml()); },

  toggleBeep() { S.settings.beep = !S.settings.beep; openModal('settings', settingsHtml()); },
  speed(arg) { S.settings.speed = Number(arg); openModal('settings', settingsHtml()); },
  disconnect() {
    stopCharge('user');
    S.connected = false;
    S.connect = { phase: 'idle', devices: [], step: 0 };
    addLog('system', 'Wand disconnected');
    closeModal();
    render();
  },
  resetDemo() {
    confirmModal('Reset demo?', 'All simulated data, programs and logs return to their starting values.', 'Reset', () => {
      S = initialState();
      Object.keys(alertSeen).forEach((k) => delete alertSeen[k]);
      render();
      toast('Demo reset');
    }, true);
  },

  /* clinician programming */
  newProg() {
    S.editIdx = S.programs.length;
    S.edit = {
      name: `Program ${S.programs.length + 1}`, desc: 'New program', caseAnode: true,
      left: { contacts: ['off', '-', 'off', 'off'], amp: 1.0, pw: 60, freq: 130 },
      right: { contacts: ['off', '-', 'off', 'off'], amp: 1.0, pw: 60, freq: 130 },
      offset: 0, offMin: -0.3, offMax: 0.3,
    };
    render();
  },
  cycleContact(arg) {
    const [side, idx] = arg.split(':');
    const c = S.edit[side].contacts;
    const i = Number(idx);
    c[i] = c[i] === 'off' ? '-' : c[i] === '-' ? '+' : 'off';
    const btn = $(`[data-arg="${arg}"]`);
    if (btn) {
      btn.className = 'contact ' + ({ off: '', '-': 'neg', '+': 'pos' }[c[i]]);
      btn.textContent = LEADS[side].labels[i] + (c[i] === 'off' ? '' : c[i] === '-' ? '−' : '+');
    }
    refreshEdit();
  },
  toggleCase(arg, e) {
    S.edit.caseAnode = !S.edit.caseAnode;
    e.target.closest('.switch').classList.toggle('on', S.edit.caseAnode);
    refreshEdit();
  },
  revertEdit() {
    if (S.editIdx >= S.programs.length) S.editIdx = S.active;
    S.edit = deep(S.programs[S.editIdx]);
    render();
    toast('Changes reverted');
  },
  sendProg() {
    const msgs = validate(S.edit);
    const errs = msgs.filter((m) => m.type === 'err');
    if (errs.length) {
      openModal('error', `
        <h2>Cannot send program</h2>
        <p class="lead-text">Fix these items first:</p>
        ${errs.map((m) => `<div class="msg err">${ic('x', 16)}<span>${esc(m.text)}</span></div>`).join('')}
        <button class="btn primary block mt" data-action="closeModal">OK</button>`);
      return;
    }
    const e = S.edit;
    const row = (side) => `<tr><td>${LEADS[side].name}</td><td>${f(e[side].amp, 1)} mA</td><td>${e[side].pw} µs</td><td>${e[side].freq} Hz</td></tr>`;
    const warns = msgs.filter((m) => m.type === 'warn');
    modalOk = transmitProgram;
    openModal('confirm', `
      <h2>Send “${esc(e.name)}” to implant?</h2>
      <p class="lead-text">The implant verifies the parameters and ramps stimulation over 5 s. Stay with the patient during the change.</p>
      <table class="t"><tr><th>Lead</th><th>Amp</th><th>PW</th><th>Rate</th></tr>${row('left')}${row('right')}</table>
      <div class="kv mt"><span>Patient range</span><b>${signed(e.offMin)} to ${signed(e.offMax)} mA</b></div>
      ${warns.map((m) => `<div class="msg warn">${ic('alert', 16)}<span>${esc(m.text)}</span></div>`).join('')}
      <div class="btn-row mt">
        <button class="btn ghost" data-action="closeModal">Cancel</button>
        <button class="btn primary" data-action="modalOk">Transmit</button>
      </div>`);
  },

  runImp() {
    if (S.ch.on) { stopCharge('user'); toast('Charging paused for the lead test'); }
    S.imp.running = true;
    S.imp.progress = 0;
    render();
    const base = { left: [1120, 985, 1046, 1212], right: [1094, 1003, 3150, 1188] };
    const timer = setInterval(() => {
      S.imp.progress = Math.min(100, S.imp.progress + 4);
      if (S.imp.progress >= 100) {
        clearInterval(timer);
        S.imp.running = false;
        S.imp.at = new Date();
        S.imp.results = {
          left: base.left.map((v) => Math.round(v + (Math.random() - 0.5) * 60)),
          right: base.right.map((v) => Math.round(v + (Math.random() - 0.5) * 60)),
        };
        addLog('therapy', 'Lead impedance test complete · E10 high (' + S.imp.results.right[2] + ' Ω)');
        addAlert('imp', 'warn', 'Lead check: one contact high', 'Contact E10 reads above 2500 Ω. Review the lead.', 5000);
        if (S.tab === 'impedance') render();
      }
      update();
    }, 90);
  },
  readStatus() {
    toast('Reading implant status…');
    setTimeout(() => {
      S.stats.lfOk++;
      addLog('system', `Implant status read · battery ${f(S.implant.soc, 0)}% · ${f(S.implant.temp, 1)} °C`);
      toast('Implant status updated', 'ok');
      update();
    }, 900);
  },

  logFilter(arg) { S.logFilter = arg; render(); },
  exportCsv() {
    const rows = [['time', 'category', 'event'], ...S.log.map((l) => [l.t.toISOString(), l.cat, l.text])];
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `spl-eiu-session-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Log exported', 'ok');
  },
  clearLog() {
    confirmModal('Clear session log?', 'All logged events are removed from this device.', 'Clear', () => { S.log = []; render(); }, true);
  },
};

function transmitProgram() {
  const steps = ['Encoding parameters', 'LF downlink to implant', 'Implant CRC check', 'Read-back verify'];
  let i = 0;
  const show = () => openModal('tx', `
    <h2>Transmitting…</h2>
    <p class="lead-text">Keep the wand over the implant.</p>
    <div class="steps">${steps.map((s, j) => `<div class="step ${j < i ? 'done' : j === i ? 'cur' : ''}"><span class="sdot">${j < i ? '✓' : j === i ? '<span class="spin"></span>' : j + 1}</span>${s}</div>`).join('')}</div>`);
  show();
  const next = () => {
    i++;
    if (i < steps.length) { show(); setTimeout(next, 600); return; }
    const saved = deep(S.edit);
    if (S.editIdx >= S.programs.length) S.programs.push(saved);
    else S.programs[S.editIdx] = saved;
    S.programs[S.editIdx].offset = clamp(S.programs[S.editIdx].offset, saved.offMin, saved.offMax);
    addLog('therapy', `Program “${saved.name}” written · L ${f(saved.left.amp, 1)} mA/${saved.left.pw} µs/${saved.left.freq} Hz · R ${f(saved.right.amp, 1)} mA/${saved.right.pw} µs/${saved.right.freq} Hz`);
    closeModal();
    render();
    toast(`“${saved.name}” saved to implant ✓`, 'ok');
  };
  setTimeout(next, 600);
}

/* ------------------------------------------------------------------ */
/* inputs                                                             */
/* ------------------------------------------------------------------ */
const FMT = {
  amp: (v) => f(v, 1),
  pw: (v) => String(v),
  freq: (v) => String(v),
  offMin: (v) => signed(v),
  offMax: (v) => signed(v),
};

function onInput(e) {
  const el = e.target.closest('[data-input]');
  if (!el) return;
  const key = el.dataset.input;
  if (key === 'editSelect') {
    S.editIdx = Number(el.value);
    S.edit = deep(S.programs[S.editIdx]);
    render();
    return;
  }
  if (key === 'set.target') {
    S.settings.target = Number(el.value);
    const lbl = $('[data-val="set.target"]');
    if (lbl) lbl.textContent = el.value;
    return;
  }
  if (!S.edit) return;
  if (key === 'name' || key === 'desc') { S.edit[key] = el.value; refreshEdit(); return; }
  const [a, b] = key.split('.');
  const v = Number(el.value);
  if (b) S.edit[a][b] = v; else S.edit[a] = v;
  const field = b || a;
  const lbl = $(`[data-val="${key}"]`);
  if (lbl) lbl.textContent = FMT[field] ? FMT[field](v) : String(v);
  refreshEdit();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn(el.dataset.arg, e);
});
document.addEventListener('input', onInput);
window.addEventListener('resize', () => drawChart());

addLog('system', 'App started');
render();
setInterval(tick, TICK * 1000);
