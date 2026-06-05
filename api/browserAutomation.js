const crypto = require('crypto');
const { formatRedeemResult } = require('./redeemMessages');

let activeSession = null;

async function closeActiveSession() {
  if (!activeSession) return;
  const { browser } = activeSession;
  activeSession = null;
  try { await browser.close(); } catch (_) { /* ignore */ }
}

function isRedeemResponseUrl(url) {
  return /\/coordinator\/api\/v1\/code\/redeem(?:-multiple)?/i.test(url);
}

async function redeemViaApi({ code, roleId, roleName, serverId }) {
  const res = await fetch('https://vgrapi-sea.vnggames.com/coordinator/api/v1/code/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'X-Client-Region': 'VN',
      'x-request-id': crypto.randomUUID(),
      'Origin': 'https://giftcode.vnggames.com',
      'Referer': 'https://giftcode.vnggames.com/'
    },
    body: JSON.stringify({ serverId, gameCode: '661', roleId, roleName, code })
  });
  const data = await res.json();
  return formatRedeemResult(data);
}

async function launchBrowser(preferHeadful = true) {
  const { chromium } = await import('playwright');

  const headfulOptions = {
    headless: false,
    slowMo: 0,
    args: ['--start-maximized'],
  };

  try {
    return {
      browser: await chromium.launch(headfulOptions),
      mode: 'headful',
    };
  } catch (headfulError) {
    if (!preferHeadful) throw headfulError;
    return {
      browser: await chromium.launch({ headless: true }),
      mode: 'headless-fallback',
    };
  }
}

async function waitForRedeemResponse(page, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout chờ phản hồi redeem từ VNG'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      page.off('response', handler);
    };

    const handler = async response => {
      try {
        const request = response.request();
        if (request.method() !== 'POST') return;
        if (!isRedeemResponseUrl(response.url())) return;

        let payload = {};
        try {
          payload = await response.json();
        } catch (_) {
          try {
            const raw = await response.text();
            payload = raw ? { message: raw } : {};
          } catch (_) {
            payload = {};
          }
        }

        cleanup();
        resolve({
          status: response.status(),
          url: response.url(),
          data: formatRedeemResult(payload),
          raw: payload,
        });
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    page.on('response', handler);
  });
}

async function fillSmart(locator, value) {
  const text = String(value ?? '').trim();
  if (!text) return false;

  try {
    await locator.fill(text);
    return true;
  } catch (_) {
    // fall through
  }

  try {
    await locator.click({ timeout: 5000 });
    await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await locator.type(text, { delay: 0 });
    return true;
  } catch (_) {
    return false;
  }
}

async function chooseServer(page, serverId) {
  if (!serverId) return false;
  const label = `Server ${serverId}`;
  const candidates = [
    page.getByRole('combobox', { name: /Server/i }).first(),
    page.getByRole('textbox', { name: /Server/i }).first(),
    page.locator('input[placeholder*="Server"], input[aria-label*="Server"]').first(),
  ];

  for (const locator of candidates) {
    try {
      if (await fillSmart(locator, label)) {
        await locator.press('Enter').catch(() => {});
        return true;
      }
    } catch (_) {
      // try next locator
    }
  }

  return false;
}

async function fillRole(page, roleId) {
  const text = String(roleId ?? '').trim();
  if (!text) return false;

  const candidates = [
    page.getByRole('combobox', { name: /Chọn nhân vật/i }).first(),
    page.getByRole('textbox', { name: /Chọn nhân vật/i }).first(),
    page.locator('input[placeholder*="Nhập ID"], input[aria-label*="Nhập ID"]').first(),
  ];

  for (const locator of candidates) {
    try {
      if (await fillSmart(locator, text)) {
        await locator.press('Enter').catch(() => {});
        return true;
      }
    } catch (_) {
      // try next locator
    }
  }

  return false;
}

async function fillCode(page, code) {
  const text = String(code ?? '').trim();
  if (!text) return false;

  const candidates = [
    page.getByRole('textbox', { name: /Nhập thông tin code/i }).first(),
    page.getByRole('textbox', { name: /Nhập code/i }).first(),
    page.locator('input[placeholder*="code" i], textarea[placeholder*="code" i], input[aria-label*="code" i], textarea[aria-label*="code" i]').first(),
  ];

  for (const locator of candidates) {
    try {
      if (await fillSmart(locator, text)) return true;
    } catch (_) {
      // try next locator
    }
  }

  return false;
}

async function dismissResultModal(page) {
  const candidates = [
    page.getByRole('button', { name: /Xác nhận|Confirm|Đóng|OK/i }).first(),
    page.getByText(/Xác nhận|Confirm/i).first(),
  ];

  for (const locator of candidates) {
    try {
      if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) {
        await locator.click({ timeout: 3000 });
        return true;
      }
    } catch (_) {
      // try next locator
    }
  }

  await page.keyboard.press('Escape').catch(() => {});
  return false;
}

async function runBrowserRedeemX2({
  code,
  roleId,
  roleName,
  serverId = '2',
  repeatCount = 2,
  keepOpen = false,
  lingerMs = 300,
} = {}) {
  const trimmedCode = String(code ?? '').trim();
  const trimmedRoleId = String(roleId ?? '').trim();
  const trimmedRoleName = String(roleName ?? '').trim() || trimmedRoleId;
  const trimmedServerId = String(serverId ?? '2').trim() || '2';

  if (!trimmedCode) throw new Error('Thiếu code');
  if (!trimmedRoleId) throw new Error('Thiếu roleId');

  await closeActiveSession();

  const { browser, mode } = await launchBrowser(true);
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  activeSession = { browser, context, page };

  page.setDefaultTimeout(8000);
  page.on('dialog', async dialog => {
    try { await dialog.accept(); } catch (_) { /* ignore */ }
  });

  const targetUrl = `https://giftcode.vnggames.com/vn/redeem/ptg?code=${encodeURIComponent(trimmedCode)}`;
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('domcontentloaded');

  await chooseServer(page, trimmedServerId);
  await fillRole(page, trimmedRoleId);
  await fillCode(page, trimmedCode);

  const submit = page.getByRole('button', { name: /Nhập code/i }).first();
  const attempts = [];

  for (let attempt = 1; attempt <= repeatCount; attempt++) {
    const responsePromise = waitForRedeemResponse(page, 2500)
      .then(response => ({ ok: true, response }))
      .catch(error => ({ ok: false, error }));

    let clickError = null;
    try {
      await submit.click({ timeout: 3000 });
    } catch (err) {
      clickError = err;
    }

    const outcome = await responsePromise;
    let response;
    if (!clickError && outcome.ok) {
      response = outcome.response;
    } else {
      response = {
        status: 200,
        url: 'fallback-api',
        data: await redeemViaApi({
          code: trimmedCode,
          roleId: trimmedRoleId,
          roleName: trimmedRoleName,
          serverId: trimmedServerId,
        }),
        raw: null,
      };
    }

    attempts.push({ attempt, transport: response.url === 'fallback-api' ? 'api' : 'browser', ...response.data });

    await dismissResultModal(page);

    if (attempt < repeatCount) {
      await page.waitForTimeout(100);
    }
  }

  await page.bringToFront().catch(() => {});
  if (!keepOpen) {
    if (lingerMs > 0) {
      await page.waitForTimeout(lingerMs);
    }
    await closeActiveSession();
  }

  return {
    success: true,
    browserMode: mode,
    code: trimmedCode,
    player: {
      roleId: trimmedRoleId,
      roleName: trimmedRoleName,
      serverId: trimmedServerId,
    },
    attempts,
  };
}

module.exports = {
  runBrowserRedeemX2,
  closeActiveSession,
};
