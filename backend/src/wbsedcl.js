// Import pdf-parse's library file directly: its index.js runs a self-test that breaks in bundled/serverless setups.
import pdf from "pdf-parse/lib/pdf-parse.js";
import { parseBillText } from "./parser.js";
import { launchBrowser } from "./browser.js";

// 20s is plenty (the site answers in ~3s) and keeps one attempt well inside a serverless time limit.
const timeout = Number(process.env.NAVIGATION_TIMEOUT_MS || 20000);
const downloadTimeout = Number(process.env.DOWNLOAD_TIMEOUT_MS || 20000);

async function clickEnglish(page) {
  const candidates = [
    page.getByRole("button", {name:/^english$/i}),
    page.getByRole("link", {name:/^english$/i}),
    page.getByText(/^english$/i)
  ];
  for (const locator of candidates) {
    try { if (await locator.first().isVisible({timeout:2500})) { await locator.first().click({timeout:5000}); return true; } } catch {}
  }
  return false;
}
async function clickGetBill(page) {
  const candidates = [
    page.getByRole("button", {name:/get\s*bill/i}),
    page.getByRole("link", {name:/get\s*bill/i}),
    page.getByText(/get\s*bill/i)
  ];
  for (const locator of candidates) {
    try { if (await locator.first().isVisible({timeout:3000})) { await locator.first().click({timeout:8000}); return true; } } catch {}
  }
  return false;
}
async function waitForPdfResponse(page) {
  return page.waitForResponse(r => {
    const ct = (r.headers()["content-type"] || "").toLowerCase();
    return ct.includes("application/pdf") || /\.pdf(?:$|\?)/i.test(r.url());
  }, {timeout:downloadTimeout}).catch(()=>null);
}

export async function fetchOneBill(consumer) {
  const browser = await launchBrowser();
  const context = await browser.newContext({acceptDownloads:true});
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  let pdfBuffer = null;
  let debug = [];
  try {
    await page.goto(consumer.billUrl, {waitUntil:"domcontentloaded",timeout});
    await page.waitForTimeout(1500);
    const englishClicked = await clickEnglish(page);
    await page.waitForTimeout(1000);
    const downloadPromise = page.waitForEvent("download",{timeout:downloadTimeout})
      .then(download=>({kind:"download",download})).catch(()=>null);
    const responsePromise = waitForPdfResponse(page)
      .then(response=>response ? ({kind:"response",response}) : null);
    const getBillClicked = await clickGetBill(page);
    const captured = await Promise.race([
      downloadPromise.then(x=>x || new Promise(()=>{})),
      responsePromise.then(x=>x || new Promise(()=>{})),
      page.waitForTimeout(downloadTimeout).then(()=>null)
    ]);
    const readDownload = async download => {
      const stream = await download.createReadStream();
      const chunks=[]; for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    };
    if (captured?.kind === "download") {
      pdfBuffer = await readDownload(captured.download);
    } else if (captured?.kind === "response") {
      // A PDF served as an attachment becomes a download, whose response body is unavailable
      // (reading it can stall ~30s before failing). So prefer the download if one follows shortly.
      const dl = await Promise.race([downloadPromise, page.waitForTimeout(5000).then(()=>null)]);
      if (dl) pdfBuffer = await readDownload(dl.download).catch(()=>null);
      if (!pdfBuffer) pdfBuffer = await captured.response.body().catch(()=>null);
    }
    if (!pdfBuffer) {
      // Fallback: a new tab or a PDF URL may have been opened by the button.
      const pdfLink = page.locator('a[href*=".pdf"], a[href*="bill"], iframe[src*=".pdf"], embed[src*=".pdf"]').first();
      try {
        const href = await pdfLink.getAttribute("href") || await pdfLink.getAttribute("src");
        if (href) {
          const absolute = new URL(href,page.url()).href;
          const response = await context.request.get(absolute);
          if (response.ok()) pdfBuffer = await response.body();
        }
      } catch {}
    }
    if (!pdfBuffer || pdfBuffer.subarray(0,4).toString() !== "%PDF") {
      const pageText = (await page.locator("body").innerText().catch(()=> "")).slice(0,1800);
      throw new Error(`Could not capture a PDF. English clicked: ${englishClicked}; Get Bill clicked: ${getBillClicked}. Page text: ${pageText}`);
    }
    const parsedPdf = await pdf(pdfBuffer);
    const parsed = parseBillText(parsedPdf.text,consumer.consumerId);
    if (parsed.consumerId && parsed.consumerId !== consumer.consumerId) {
      throw new Error(`Consumer ID mismatch: expected ${consumer.consumerId}, PDF contains ${parsed.consumerId}`);
    }
    return {...parsed,consumerId:consumer.consumerId,pdfBuffer,pdfAvailable:true,englishClicked,getBillClicked,pdfPages:parsedPdf.numpages};
  } finally {
    await context.close().catch(()=>{});
    await browser.close().catch(()=>{});
  }
}
