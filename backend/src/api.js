// Framework-neutral API handlers, shared by the local Express server (server.js)
// and the Vercel functions (/api/*.js). Each returns { status, body }.
// The API is stateless: every bill is fetched in its own request and the PDF is
// returned to the browser, which does any merging itself.
import { consumers } from "./config.js";
import { fetchOneBill } from "./wbsedcl.js";

export const isAuthorized = key => !process.env.API_KEY || key === process.env.API_KEY;
export const unauthorized = { status: 401, body: { error: "Unauthorized" } };

export const health = () => ({ status: 200, body: { ok: true, service: "wbsedcl-bill-tracker", consumers: consumers.length } });

export const listConsumers = () => ({ status: 200, body: consumers.map(({ consumerId }) => ({ consumerId })) });

export async function fetchBill(consumerId) {
  const consumer = consumers.find(c => c.consumerId === String(consumerId ?? ""));
  if (!consumer) return { status: 400, body: { error: "Unknown consumer ID." } };
  try {
    const { pdfBuffer, rawText, ...result } = await fetchOneBill(consumer);
    return { status: 200, body: { ...result, pdfBase64: pdfBuffer.toString("base64") } };
  } catch (e) {
    return { status: 502, body: { consumerId: consumer.consumerId, error: e.message } };
  }
}
