// POST { consumerId } -> parsed bill fields + pdfBase64. One bill per call keeps each run well inside maxDuration.
import { isAuthorized, unauthorized, fetchBill } from "../backend/src/api.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const { status, body } = isAuthorized(req.headers["x-api-key"]) ? await fetchBill(req.body?.consumerId) : unauthorized;
  res.status(status).json(body);
}
