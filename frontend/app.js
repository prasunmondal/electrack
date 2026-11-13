const cfg = window.APP_CONFIG || {};
const API = (cfg.API_BASE_URL || "").replace(/\/$/, "");
const $ = id => document.getElementById(id);
let results = [];
const pdfStore = new Map(); // consumerId -> {bytes: Uint8Array, url: blob URL}

// API key: from config.js, or asked once and remembered in this browser.
const KEY_STORAGE = "wbsedcl.apiKey";
function apiKey() {
  if (cfg.API_KEY) return cfg.API_KEY;
  try { return localStorage.getItem(KEY_STORAGE) || ""; } catch { return ""; }
}
function headers() {
  const h = {"Content-Type":"application/json"};
  const key = apiKey(); if (key) h["x-api-key"] = key;
  return h;
}
// fetch() against the API; on 401 asks for the key once and retries.
async function api(path, options = {}) {
  let response = await fetch(`${API}${path}`, {...options, headers: headers()});
  if (response.status === 401) {
    const key = prompt("This tracker is protected. Enter the API key:");
    if (key) {
      try { localStorage.setItem(KEY_STORAGE, key.trim()); } catch {}
      response = await fetch(`${API}${path}`, {...options, headers: {...headers(), "x-api-key": key.trim()}});
    }
  }
  return response;
}
function log(message, type="") {
  const line = document.createElement("div"); line.className = "log-line";
  const time = document.createElement("span"); time.className = "time"; time.textContent = new Date().toLocaleTimeString();
  const msg = document.createElement("span"); msg.textContent = message;
  line.append(time,msg); $("log").prepend(line);
}
function safe(v) { return v === null || v === undefined || v === "" ? "—" : String(v); }
const REQUIRED_FIELDS = ["name","prevReading","latestReading","amountBeforeRebate","amountAfterRebate"];
const isComplete = r => r.pdfAvailable && REQUIRED_FIELDS.every(k => r[k] !== null && r[k] !== undefined && r[k] !== "");
function statusPill(row) {
  if (row.pending) return `<span class="pill pend">${row.attempts > 1 ? `Retrying (${row.attempts})…` : "Fetching…"}</span>`;
  const tries = row.attempts > 1 ? ` <span class="muted">(${row.attempts} tries)</span>` : "";
  if (row.error) return `<span class="pill fail">Failed</span>${tries}`;
  return (isComplete(row) ? '<span class="pill ok">Extracted</span>' : '<span class="pill warn">Check PDF</span>') + tries;
}
// Bill split: shared connections are divided equally (rounded up); "own" connections are paid in full.
const SPLIT = {
  shared: ["101256487", "101310436", "164078438"],
  sharedLabel: "Home",
  people: [
    {name: "Prabir Mondal", own: [{id: "164216951", label: "Dokan"}]},
    {name: "Pranab Mondal", own: []}
  ]
};
const ownIds = p => p.own.map(o => o.id);
const rupees = v => v.toLocaleString("en-IN", {maximumFractionDigits: 0});
// Computes each person's lines from the current results (assumes all needed bills are complete).
function computeSplit() {
  const amt = id => parseFloat(results.find(x => x.consumerId === id)?.amountAfterRebate) || 0;
  const sharedAmts = SPLIT.shared.map(amt);
  const sharedTotal = sharedAmts.reduce((t, v) => t + v, 0);
  const share = Math.ceil(sharedTotal / SPLIT.people.length);
  return SPLIT.people.map(p => {
    const lines = [{label: SPLIT.sharedLabel, expr: `(${sharedAmts.join(" + ")}) / ${SPLIT.people.length} = ${rupees(share)}`, value: share},
      ...p.own.map(o => ({label: o.label, expr: rupees(amt(o.id)), value: amt(o.id)}))];
    return {name: p.name, lines, total: lines.reduce((t, l) => t + l.value, 0)};
  });
}
function billingMonthLabel() {
  const [y, m] = mergedName().match(/(\d{4})\.(\d{2})/).slice(1);
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(m) - 1]} ${y}`;
}
function renderSplit() {
  const el = $("splitView");
  if (!results.length) { el.innerHTML = '<div class="empty">Fetch bills to see the split.</div>'; return; }
  // Only show the split once every bill it depends on was fetched and fully processed.
  const needed = [...new Set([...SPLIT.shared, ...SPLIT.people.flatMap(ownIds)])];
  const notReady = needed.filter(id => { const r = results.find(x => x.consumerId === id); return !r || r.error || !isComplete(r); });
  if (notReady.length) {
    el.innerHTML = `<div class="empty"><span class="pill warn">Waiting for bills</span> The split is shown only when all bills are fetched and processed. Not ready: ${notReady.join(", ")}. Fetch again.</div>`;
    return;
  }
  el.innerHTML = computeSplit().map(p => {
    const rows = p.lines.map(l => `<tr><td>${l.label}</td><td class="num">${l.expr}</td></tr>`).join("");
    return `<div class="person"><div class="person-head"><h4>${p.name}</h4><button class="secondary small" data-share-person="${p.name}">⇪ Share</button></div><div class="amount">₹${rupees(p.total)}</div><table><tbody>${rows}</tbody></table></div>`;
  }).join("");
}
function render() {
  renderSplit();
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const diff = (a, b) => a === null || b === null ? null : a - b;
  const units = r => diff(num(r.latestReading), num(r.prevReading));           // Latest reading - Prev. reading
  const rebate = r => diff(num(r.amountAfterRebate), num(r.amountBeforeRebate)); // negative = discount
  const rebateCell = v => v === null ? "—" : (v < 0 ? "−" + Math.abs(v) : String(v));
  $("billRows").innerHTML = results.length ? results.map(r => `
    <tr>
      <td class="consumer">${safe(r.consumerId)}</td><td class="name">${safe(r.name)}</td>
      <td class="value">${safe(r.prevReading)}</td><td class="value">${safe(r.latestReading)}</td>
      <td class="value units">${safe(units(r))}</td>
      <td class="value">${safe(r.amountBeforeRebate)}</td><td class="value rebate">${rebateCell(rebate(r))}</td><td class="value">${safe(r.amountAfterRebate)}</td>
      <td>${statusPill(r)}</td><td>${pdfStore.has(r.consumerId) ? `<a class="pdf-link" href="${pdfStore.get(r.consumerId).url}" target="_blank" rel="noopener">PDF ↗</a>` : "—"}</td>
    </tr>`).join("") : '<tr><td colspan="10" class="empty">No bill data yet.</td></tr>';
  const sumOf = f => results.reduce((t, r) => t + (f(r) ?? 0), 0);
  const sum = key => results.reduce((t, r) => t + (Number.isFinite(parseFloat(r[key])) ? parseFloat(r[key]) : 0), 0);
  const counted = key => results.filter(r => Number.isFinite(parseFloat(r[key]))).length;
  const partial = results.length && (counted("amountBeforeRebate") < results.length || counted("amountAfterRebate") < results.length);
  $("billTotals").innerHTML = results.length ? `
    <tr>
      <td class="consumer">Total</td><td class="name">${results.length} consumer${results.length === 1 ? "" : "s"}</td>
      <td></td><td></td><td class="value units">${sumOf(units)}</td>
      <td class="value">${sum("amountBeforeRebate")}</td><td class="value rebate">${rebateCell(sumOf(rebate))}</td><td class="value">${sum("amountAfterRebate")}</td>
      <td>${partial ? '<span class="pill warn">Partial</span>' : ""}</td><td></td>
    </tr>` : "";
  $("fetchedCount").textContent = results.filter(r=>r.pdfAvailable).length;
  $("reviewCount").textContent = results.filter(r=>!r.pending && (r.error || !isComplete(r))).length;
  $("exportCsv").disabled = !results.length;
  mergedFile = null; // results changed, so rebuild the merged PDF next time
  setPdfButtons(false);
}
let mergedFile = null; // cached merged PDF for the current results
// "ElectricityBill.<YYYY>.<MM>.pdf", using the billing month shared by most bills
// (ties go to the later month; falls back to the current month if no dates were parsed).
function mergedName() {
  const counts = {};
  for (const r of results) {
    if (!r.pdfAvailable) continue;
    const m = String(r.billDate || "").match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (!m) continue;
    const year = m[3].length === 2 ? "20" + m[3] : m[3];
    const key = `${year}.${m[2].padStart(2, "0")}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || b.localeCompare(a));
  const now = new Date();
  const month = keys[0] || `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `ElectricityBill.${month}.pdf`;
}
// Merges the fetched bill PDFs in the browser (pdf-lib), in consumer order.
async function getMergedPdf() {
  if (mergedFile) return mergedFile;
  if (!window.PDFLib) throw new Error("PDF library failed to load; check the internet connection and reload.");
  const merged = await PDFLib.PDFDocument.create();
  for (const r of results) {
    const pdf = pdfStore.get(r.consumerId);
    if (!pdf) continue;
    const src = await PDFLib.PDFDocument.load(pdf.bytes, {ignoreEncryption: true});
    (await merged.copyPages(src, src.getPageIndices())).forEach(p => merged.addPage(p));
  }
  mergedFile = new File([await merged.save()], mergedName(), {type:"application/pdf"});
  return mergedFile;
}
function saveFile(file) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
function setPdfButtons(disabled) {
  const none = !results.some(r => r.pdfAvailable);
  $("mergedPdf").disabled = disabled || none; $("sharePdf").disabled = disabled || none;
}
async function downloadMergedPdf() {
  setPdfButtons(true);
  try {
    saveFile(await getMergedPdf());
    log(`Merged PDF downloaded (${results.filter(r=>r.pdfAvailable).length} bills).`);
  } catch (e) { log(`Merged PDF error: ${e.message}`); }
  finally { setPdfButtons(false); }
}
async function shareMergedPdf() {
  setPdfButtons(true);
  try {
    const file = await getMergedPdf();
    const before = $("billTotals").querySelector("td:nth-child(5)")?.textContent;
    const after = $("billTotals").querySelector("td:nth-child(6)")?.textContent;
    const data = {files:[file], title:"WBSEDCL electricity bills",
      text:`WBSEDCL bills (${results.filter(r=>r.pdfAvailable).length}). Total before rebate ₹${before}, after rebate ₹${after}.`};
    await shareOrDownload(data, "Merged PDF");
  } catch (e) { log(`Share error: ${e.message}`); }
  finally { setPdfButtons(false); }
}
async function shareOrDownload(data, label) {
  try {
    if (navigator.canShare && navigator.canShare(data)) {
      await navigator.share(data);
      log(`${label} shared.`);
    } else {
      saveFile(data.files[0]);
      log(`This browser can't share files — ${label} was downloaded instead.`);
    }
  } catch (e) {
    if (e.name === "AbortError") log("Share cancelled.");
    else throw e;
  }
}
// Draws a small statement card (PNG) for one person.
async function statementImage(p) {
  const W = 640, S = 2, pad = 32, rowH = 34;
  const title = `Electricity Statement for ${p.name} - ${billingMonthLabel()}`;
  const H = 76 + 24 + 74 + 28 + 40 + p.lines.length * rowH + 14 + 40 + 38;
  const c = document.createElement("canvas"); c.width = W * S; c.height = H * S;
  const g = c.getContext("2d"); g.scale(S, S);
  const font = (w, px) => `${w} ${px}px Inter, "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif`;
  const fit = (text, w, px, max) => { g.font = font(w, px); while (g.measureText(text).width > max && px > 10) g.font = font(w, --px); };
  // background + header band
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#102a43"; g.fillRect(0, 0, W, 76);
  g.fillStyle = "#83d6d2"; g.font = font(800, 10); g.fillText("WBSEDCL · ELECTRICITY", pad, 28);
  g.fillStyle = "#ffffff"; fit(title, 700, 20, W - 2 * pad); g.fillText(title, pad, 56);
  // payment summary box
  let y = 100;
  g.fillStyle = "#eef8f8"; g.strokeStyle = "#cfe9e9"; g.lineWidth = 1;
  g.beginPath(); g.roundRect(pad, y, W - 2 * pad, 74, 12); g.fill(); g.stroke();
  g.fillStyle = "#172b4d"; fit(`${p.name} pays`, 600, 17, 260); g.textBaseline = "middle"; g.fillText(`${p.name} pays`, pad + 18, y + 37);
  g.fillStyle = "#087e8b"; g.font = font(800, 30); g.textAlign = "right"; g.fillText(`Rs. ${rupees(p.total)}`, W - pad - 18, y + 38);
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  // details
  y += 74 + 28 + 14;
  g.fillStyle = "#102a43"; g.font = font(800, 15); g.fillText("Details:", pad, y);
  y += 12;
  const row = (label, value, bold, color) => {
    y += rowH;
    g.fillStyle = color; g.font = font(bold ? 800 : 600, 15); g.fillText(`${label}:`, pad, y - 11);
    g.font = font(bold ? 800 : 400, 15); g.textAlign = "right"; g.fillText(value, W - pad, y - 11); g.textAlign = "left";
  };
  for (const l of p.lines) { row(l.label, l.expr, false, "#172b4d"); g.strokeStyle = "#edf2f7"; g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke(); }
  y += 6; g.strokeStyle = "#102a43"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke();
  row("Total", `₹${rupees(p.total)}`, true, "#087e8b");
  // footnote
  g.fillStyle = "#94a3b8"; g.font = font(400, 11);
  g.fillText("Amounts after rebate (e-Payment within 1st due date), rounded up to whole rupees.", pad, H - 18);
  const blob = await new Promise(r => c.toBlob(r, "image/png"));
  return new File([blob], mergedName().replace(/\.pdf$/, `.${p.name.replace(/[^A-Za-z0-9]/g, "")}.png`), {type: "image/png"});
}
async function shareSplitImage(btn) {
  const p = computeSplit().find(x => x.name === btn.dataset.sharePerson);
  if (!p) return;
  btn.disabled = true;
  try {
    const file = await statementImage(p);
    await shareOrDownload({files: [file], title: `Electricity Statement for ${p.name} - ${billingMonthLabel()}`,
      text: `${p.name} pays Rs. ${rupees(p.total)} (${billingMonthLabel()}).`}, `${p.name}'s statement`);
  } catch (e) { log(`Statement error for ${p.name}: ${e.message}`); }
  finally { btn.disabled = false; }
}
// Each bill is fetched in its own API call (fits serverless time limits), a few at a time,
// and retried if it fails or comes back incomplete.
const FETCH_ATTEMPTS = 3, RETRY_DELAY_MS = 3000, PARALLEL = 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function base64ToBytes(b64) { const s = atob(b64); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
async function fetchOne(consumerId, update) {
  let last = {consumerId, error: "Not fetched", pdfAvailable: false};
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    update({consumerId, pending: true, attempts: attempt});
    try {
      const response = await api("/api/fetch-bill", {method: "POST", body: JSON.stringify({consumerId})});
      const text = await response.text();
      let body; try { body = JSON.parse(text); } catch { body = {error: `HTTP ${response.status}: ${text.slice(0, 200)}`}; }
      if (response.status === 401) return {consumerId, error: "Unauthorized (wrong or missing API key)", pdfAvailable: false, attempts: attempt};
      last = {consumerId, pdfAvailable: false, ...body, attempts: attempt};
      if (response.ok && isComplete(last)) break;
      if (response.ok && !last.error) last.error = null;
    } catch (e) { last = {consumerId, error: e.message, pdfAvailable: false, attempts: attempt}; }
    if (attempt < FETCH_ATTEMPTS) { log(`${consumerId}: attempt ${attempt} ${last.error ? "failed" : "incomplete"}; retrying.`); await sleep(RETRY_DELAY_MS); }
  }
  if (last.pdfBase64) {
    const bytes = base64ToBytes(last.pdfBase64);
    pdfStore.set(consumerId, {bytes, url: URL.createObjectURL(new Blob([bytes], {type: "application/pdf"}))});
    delete last.pdfBase64;
  }
  return last;
}
async function fetchBills() {
  $("fetchAll").disabled = true; $("runStatus").textContent = "Fetching…"; $("lastRun").textContent = "Running";
  for (const p of pdfStore.values()) URL.revokeObjectURL(p.url);
  pdfStore.clear(); results = []; render(); log("Starting WBSEDCL bill retrieval.");
  try {
    const response = await api("/api/consumers");
    if (!response.ok) throw new Error(`Backend returned HTTP ${response.status}: ${await response.text()}`);
    const ids = (await response.json()).map(c => c.consumerId);
    results = ids.map(consumerId => ({consumerId, pending: true})); render();
    const update = row => { results = results.map(r => r.consumerId === row.consumerId ? row : r); render(); };
    const queue = [...ids];
    await Promise.all(Array.from({length: Math.min(PARALLEL, ids.length)}, async () => {
      while (queue.length) {
        const id = queue.shift();
        const row = await fetchOne(id, update);
        update(row);
        log(row.error ? `${id}: ${row.error.split("\n")[0]}` : `${id}: PDF downloaded; extraction ${isComplete(row) ? "completed" : "incomplete — check PDF"}.`);
      }
    }));
    const failed = results.filter(r => r.error).length;
    $("runStatus").textContent = failed ? `Completed with ${failed} failed` : "Completed";
    $("lastRun").textContent = new Date().toLocaleTimeString();
  } catch (e) { log(`Error: ${e.message}`); $("runStatus").textContent = "Error"; }
  finally { $("fetchAll").disabled = false; }
}
function exportCsv() {
  const columns = ["consumerId","name","prevReading","latestReading","amountBeforeRebate","amountAfterRebate","billDate","error"];
  const esc = v => `"${String(v ?? "").replace(/"/g,'""')}"`;
  const csv = [columns.join(","), ...results.map(r=>columns.map(k=>esc(r[k])).join(","))].join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"})); a.download = "wbsedcl-bills.csv"; a.click(); URL.revokeObjectURL(a.href);
}
$("fetchAll").addEventListener("click", fetchBills);
$("exportCsv").addEventListener("click", exportCsv);
$("mergedPdf").addEventListener("click", downloadMergedPdf);
$("sharePdf").addEventListener("click", shareMergedPdf);
$("splitView").addEventListener("click", e => { const btn = e.target.closest("[data-share-person]"); if (btn) shareSplitImage(btn); });
fetch(`${API}/api/health`).then(r=>r.json()).then(()=>log("Backend connection successful.")).catch(()=>log("Backend not reachable. Start the local backend (run-local.cmd) or check the deployment."));
