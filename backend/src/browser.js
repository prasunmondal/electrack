// Launches headless Chromium.
// - On Vercel / AWS Lambda: playwright-core + @sparticuz/chromium (a Chromium build small enough for serverless).
// - Everywhere else (local, Docker): the full `playwright` package and its bundled Chromium.
// Keep playwright-core's Chromium version in step with @sparticuz/chromium (1.63.0 <-> 153.x).
const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

export async function launchBrowser() {
  if (serverless) {
    const [{ chromium }, { default: sparticuz }] = await Promise.all([import("playwright-core"), import("@sparticuz/chromium")]);
    return chromium.launch({ executablePath: await sparticuz.executablePath(), args: sparticuz.args, headless: true });
  }
  const { chromium } = await import("playwright");
  return chromium.launch({ headless: true, args: ["--no-sandbox"] });
}

export const isServerless = serverless;
