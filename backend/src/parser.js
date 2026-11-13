function clean(s) {
  return String(s ?? "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
}
function firstMatch(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return clean(m[1]);
  }
  return null;
}
function money(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g,"").match(/-?\d+(?:\.\d{1,2})?/);
  return m ? String(Math.ceil(Number(m[0]))) : null; // amounts are whole rupees, rounded up
}
function reading(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g,"").match(/-?\d+(?:\.\d+)?/);
  return m ? String(Math.round(Number(m[0]))) : null; // meter readings are integers
}
export function parseBillText(rawText, expectedConsumerId) {
  const text = clean(rawText).replace(/\r/g,"\n");
  const consumerId = firstMatch(text, [
    /(?:Consumer\s*(?:ID|No\.?|Number)|CA\s*No\.?)\s*[:#-]?\s*(\d{8,})/i,
    /\b(10\d{7}|16\d{7})\b/
  ]);
  // WBSEDCL bill layout: name is the first field on the "Invoice No." line;
  // readings are in the meter table row: "<MeterNo> <Time> <Previous> <Present> <MF> <Units>".
  const meterRow = text.match(/Reading\s+Reading[^\n]*\n\s*\S+\s+[A-Z]{1,3}\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)(?:[ \t]+[\d.]+[ \t]+([\d,]+(?:\.\d+)?))?/i);
  const unitsConsumed = reading(meterRow?.[3]);
  const name = firstMatch(text, [
    /^\s*([A-Z][A-Z .'&-]+?)\s+Invoice\s*No/m,
    /(?:Consumer\s*Name|Name\s*of\s*Consumer|Customer\s*Name)\s*[:\-]?\s*([A-Z][A-Z .'-]{2,})/i,
    /(?:Mr\.?|Mrs\.?|Ms\.?)\s+([A-Z][A-Z .'-]{2,})/i
  ]);
  const prevReading = reading(meterRow?.[1] ?? firstMatch(text, [
    /(?:Previous|Prev\.?)\s*(?:Meter\s*)?Reading\s*[:\-]?\s*([\d,]+(?:\.\d+)?)/i,
    /Previous\s*Reading[\s\S]{0,60}?([\d,]+(?:\.\d+)?)/i
  ]));
  const latestReading = reading(meterRow?.[2] ?? firstMatch(text, [
    /(?:Present|Current|Latest)\s*(?:Meter\s*)?Reading\s*[:\-]?\s*([\d,]+(?:\.\d+)?)/i,
    /(?:Present|Current)\s*Reading[\s\S]{0,60}?([\d,]+(?:\.\d+)?)/i
  ]));
  const amountBeforeRebate = money(firstMatch(text, [
    /Total\s*Amount\s*Payable\s*at\s*a\s*time\s*within\s*1st\s*Due\s*date\*?\s*\(Rs\.\)\s*([\d,]+(?:\.\d{1,2})?)/i
  ]) ?? firstMatch(text, [
    /(?:Bill\s*Amount|Gross\s*Amount|Amount\s*Payable\s*before\s*Rebate|Amount\s*before\s*Rebate)\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:Energy\s*Bill|Net\s*Bill\s*Amount)\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i
  ]));
  const amountAfterRebate = money(firstMatch(text, [
    /Amount\s*payable\s*at\s*a\s*time\s*through\s*e-?Payment\s*within\s*1st\s*Due\s*date\s*(?:\(Rs\.\))?\s*([\d,]+(?:\.\d{1,2})?)/i
  ]) ?? firstMatch(text, [
    /(?:Bill\s*Amount\s*after\s*Rebate|Amount\s*Payable\s*after\s*Rebate|Payable\s*Amount|Net\s*Payable|Amount\s*Due)\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:Rebate\s*deducted|After\s*Rebate)[\s\S]{0,80}?(?:Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i
  ]));
  const billDate = firstMatch(text, [/(?:Billing\s*Date|Bill\s*Date|Date\s*of\s*Issue)\s*[:\-]?\s*([0-3]?\d[-/.][01]?\d[-/.]\d{2,4})/i]);
  return {
    consumerId: consumerId || expectedConsumerId,
    consumerIdVerified: consumerId ? consumerId === expectedConsumerId : false,
    name, prevReading, latestReading, unitsConsumed, amountBeforeRebate, amountAfterRebate, billDate,
    rawText: text
  };
}
