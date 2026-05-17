const crypto = require('crypto');
const db = require('./db');

function uuidv4() { return crypto.randomUUID(); }

// ============== VNG API ==============

const ERROR_MESSAGES = {
  1: 'Thành công! Kiểm tra hộp thư trong game.',
  1002: 'Không tìm thấy thông tin nhân vật.',
  2102: 'Nhận quà không thành công.',
  2105: 'Nhân vật không tồn tại hoặc đang offline.',
  2106: 'Mã code không tồn tại.',
  2107: 'Mã code đã hết hạn.',
  2108: 'Mã code đã được sử dụng.',
  2109: 'Bạn đã nhận loại mã này rồi.',
  2110: 'Nhập trùng loại mã hoặc mã đã được sử dụng.',
  2111: 'Nhận quà không thành công.',
  2113: 'Không tìm thấy thông tin nhân vật.',
  2114: 'Tài khoản đã bị khóa.',
  2115: 'Định dạng mã không hợp lệ.',
  2116: 'Không tìm thấy dữ liệu.',
  2117: 'Mã đã đạt giới hạn lượt nhập.',
  2119: 'Mã code không hợp lệ.',
  2120: 'Lỗi khi nhận quà.',
  2121: 'Vượt quá số lần nhập cho loại mã này.',
  2126: 'Mã không áp dụng cho server của bạn.',
  2127: 'Đã nhận mã cho chuỗi sự kiện này rồi.'
};

async function redeemCode({ code, roleId, roleName, serverId, gameCode }) {
  const res = await fetch('https://vgrapi-sea.vnggames.com/coordinator/api/v1/code/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'X-Client-Region': 'VN',
      'x-request-id': uuidv4(),
      'Origin': 'https://giftcode.vnggames.com',
      'Referer': 'https://giftcode.vnggames.com/'
    },
    body: JSON.stringify({ serverId, gameCode, roleId, roleName, code })
  });
  const data = await res.json();
  const viMessage = ERROR_MESSAGES[data.errorCode];
  const rawMessage = data.description || data.message || '';
  return {
    success: data.errorCode === 1,
    errorCode: data.errorCode,
    message: viMessage || rawMessage || 'Lỗi không xác định',
    detail: rawMessage
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============== External source codes ==============

const SOURCE_SITE_URL = 'https://nhasangtaoptg.com/';
const SOURCE_SITE_TIMEOUT_MS = 15000;

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, codePoint) => String.fromCharCode(Number(codePoint)));
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || ''))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSourceCodes(html) {
  const items = [];
  const seen = new Set();
  const regex = /data-src=['"]https:\/\/(?:stc-billing\.mto\.zing\.vn|scdn-stc-billing\.vnggames\.com)\/ptg\/([^'"?#]+)\.png['"]/gi;

  for (const match of html.matchAll(regex)) {
    const code = match[1];
    const key = code.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const index = match.index || 0;
    const window = html.slice(Math.max(0, index - 1200), Math.min(html.length, index + 2500));
    const titleMatch = window.match(/<div class='product-title'>([\s\S]*?)<\/div>/i);
    const statusMatch = window.match(/<div class='product-price'>([\s\S]*?)<\/div>/i);
    const title = stripHtml(titleMatch ? titleMatch[1] : '');
    const status = stripHtml(statusMatch ? statusMatch[1] : '');
    const active = !/h\u1ebft m\u00e3|hết mã/i.test(status);

    items.push({
      code,
      title,
      status,
      active,
      imageUrl: `https://stc-billing.mto.zing.vn/ptg/${code}.png`
    });
  }

  return items;
}

async function fetchSourceCodes({ activeOnly = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_SITE_TIMEOUT_MS);

  try {
    const res = await fetch(SOURCE_SITE_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!res.ok) {
      throw new Error(`Nguồn trả về HTTP ${res.status}`);
    }

    const html = await res.text();
    const all = extractSourceCodes(html);
    const codes = activeOnly ? all.filter(item => item.active) : all;

    return {
      sourceUrl: SOURCE_SITE_URL,
      updatedAt: new Date().toISOString(),
      totalCount: all.length,
      activeCount: all.filter(item => item.active).length,
      codes
    };
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`Hết thời gian chờ khi lấy code từ ${SOURCE_SITE_URL}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleSourceCodes(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const activeOnly = ['1', 'true', 'yes', 'on'].includes(String(req.query?.activeOnly || '').toLowerCase());
  try {
    const data = await fetchSourceCodes({ activeOnly });
    return res.json({ success: true, ...data });
  } catch (err) {
    console.error('Source code fetch error:', err);
    return res.status(502).json({
      success: false,
      message: 'Không lấy được code từ nguồn',
      detail: err.message,
      sourceUrl: SOURCE_SITE_URL
    });
  }
}

// ============== Body parser ==============

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

// ============== Route: Players ==============

async function handlePlayers(req, res) {
  if (req.method === 'GET') {
    return res.json({ success: true, data: await db.loadPlayers() });
  }

  if (req.method === 'POST') {
    const { roleId, roleName, serverId } = parseBody(req);
    if (!roleId) return res.status(400).json({ success: false, message: 'roleId là bắt buộc' });

    const sid = serverId || '2';
    const existing = await db.findPlayer(roleId.trim(), sid);
    if (existing) return res.status(400).json({ success: false, message: 'Người chơi này đã tồn tại' });

    const player = {
      id: uuidv4(),
      roleId: roleId.trim(),
      roleName: (roleName || roleId).trim(),
      serverId: sid,
      createdAt: new Date().toISOString()
    };
    await db.addPlayer(player);
    return res.json({ success: true, data: player });
  }

  res.status(405).json({ success: false, message: 'Method not allowed' });
}

// ============== Route: Players Bulk ==============

async function handlePlayersBulk(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const { roleIds, players: playerEntries, serverId } = parseBody(req);
  const sid = serverId || '2';

  let entries = [];
  if (Array.isArray(playerEntries)) {
    entries = playerEntries.map(p => ({
      roleId: (p.roleId || '').trim(),
      roleName: (p.roleName || p.roleId || '').trim()
    })).filter(p => p.roleId);
  } else if (Array.isArray(roleIds)) {
    entries = roleIds.map(rid => ({ roleId: rid.trim(), roleName: rid.trim() })).filter(p => p.roleId);
  }

  if (entries.length === 0) {
    return res.status(400).json({ success: false, message: 'Danh sách người chơi không hợp lệ' });
  }

  let added = 0, skipped = 0;
  for (const entry of entries) {
    const exists = await db.findPlayer(entry.roleId, sid);
    if (exists) { skipped++; continue; }
    await db.addPlayer({
      id: uuidv4(),
      roleId: entry.roleId,
      roleName: entry.roleName || entry.roleId,
      serverId: sid,
      createdAt: new Date().toISOString()
    });
    added++;
  }

  res.json({ success: true, added, skipped });
}

// ============== Route: Redeem ==============

async function handleRedeem(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const { code, delayMs, sourceAuto } = parseBody(req);
  if (!code || !code.trim()) return res.status(400).json({ success: false, message: 'Code không được để trống' });

  const players = await db.loadPlayers();
  if (players.length === 0) return res.status(400).json({ success: false, message: 'Chưa có người chơi nào' });

  const trimmedCode = code.trim();

  // Build set of roleIds that have already successfully redeemed this code in the past.
  const history = await db.loadHistory();
  const priorSuccess = new Set();
  for (const h of history) {
    if (!h || (h.code || '').trim() !== trimmedCode) continue;
    if (!Array.isArray(h.results)) continue;
    for (const r of h.results) {
      if (r && r.success && r.roleId) priorSuccess.add(String(r.roleId));
    }
  }

  const delay = Math.max(delayMs || 1000, 500);
  const results = [];

  // Stream NDJSON: client reads each line as it arrives so it can show "đang nhập cho ai".
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (obj) => {
    res.write(JSON.stringify(obj) + '\n');
    if (typeof res.flush === 'function') res.flush();
  };

  const skippedCount = players.filter(p => priorSuccess.has(String(p.roleId))).length;
  send({ type: 'start', total: players.length, code: trimmedCode, skipped: skippedCount });

  let lastCalledIdx = -1;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const alreadyDone = priorSuccess.has(String(p.roleId));

    send({
      type: 'progress',
      index: i,
      current: i + 1,
      total: players.length,
      roleId: p.roleId,
      roleName: p.roleName,
      serverId: p.serverId,
      skipped: alreadyDone
    });

    let entry;
    if (alreadyDone) {
      entry = {
        roleId: p.roleId,
        roleName: p.roleName,
        success: true,
        skipped: true,
        errorCode: 0,
        message: 'Đã nhập code này trước đó — bỏ qua'
      };
      results.push(entry);
      send({ type: 'result', index: i, current: i + 1, total: players.length, result: entry });
      continue;
    }

    // Delay between actual API calls (not between skipped players)
    if (lastCalledIdx !== -1) await sleep(delay);

    try {
      const r = await redeemCode({ code: trimmedCode, roleId: p.roleId, roleName: p.roleName, serverId: p.serverId, gameCode: '661' });
      entry = { roleId: p.roleId, roleName: p.roleName, ...r };
    } catch (err) {
      entry = { roleId: p.roleId, roleName: p.roleName, success: false, errorCode: -1, message: err.message };
    }
    results.push(entry);
    lastCalledIdx = i;
    send({ type: 'result', index: i, current: i + 1, total: players.length, result: entry });
  }

  const successCount = results.filter(r => r.success && !r.skipped).length;
  const skipResultCount = results.filter(r => r.skipped).length;
  const failCount = results.filter(r => !r.success).length;
  const attempted = players.length - skipResultCount;

  const summary = {
    success: true,
    code: trimmedCode,
    total: players.length,
    attempted,
    successCount,
    failCount,
    skippedCount: skipResultCount,
    results
  };

  // Only record history when there was at least one real attempt
  if (attempted > 0) {
    await db.addHistory({
      id: uuidv4(),
      code: trimmedCode,
      timestamp: new Date().toISOString(),
      totalPlayers: players.length,
      successCount,
      failCount,
      skippedCount: skipResultCount,
      autoSource: !!sourceAuto,
      results
    });
  }

  send({ type: 'done', summary });
  res.end();
}

// ============== Route: Redeem Single ==============

async function handleRedeemSingle(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const { code, roleId, roleName, serverId } = parseBody(req);
  if (!code || !roleId) return res.status(400).json({ success: false, message: 'Code và roleId là bắt buộc' });

  const trimmedCode = String(code).trim();
  const sid = serverId || '2';
  const rname = (roleName || roleId).toString();

  try {
    const result = await redeemCode({ code: trimmedCode, roleId, roleName: rname, serverId: sid, gameCode: '661' });
    const entry = { roleId, roleName: rname, serverId: sid, ...result };
    const success = !!result.success;

    // Ghi history single-redeem với cùng shape như redeem all
    await db.addHistory({
      id: uuidv4(),
      code: trimmedCode,
      timestamp: new Date().toISOString(),
      totalPlayers: 1,
      successCount: success ? 1 : 0,
      failCount: success ? 0 : 1,
      skippedCount: 0,
      single: true,
      results: [entry]
    });

    res.json({ success: true, ...result });
  } catch (err) {
    const entry = { roleId, roleName: rname, serverId: sid, success: false, errorCode: -1, message: err.message };
    try {
      await db.addHistory({
        id: uuidv4(),
        code: trimmedCode,
        timestamp: new Date().toISOString(),
        totalPlayers: 1,
        successCount: 0,
        failCount: 1,
        skippedCount: 0,
        single: true,
        results: [entry]
      });
    } catch (_) { /* ghi history lỗi không chặn response */ }
    res.json({ success: false, errorCode: -1, message: err.message });
  }
}

// ============== Auth helper ==============

function checkAdminPassword(req, res) {
  const adminPw = process.env.ADMIN_PASSWORD;
  if (!adminPw) {
    res.status(503).json({ success: false, message: 'Chưa cấu hình mật khẩu admin trên server' });
    return false;
  }
  const { password } = parseBody(req);
  if (!password || password !== adminPw) {
    res.status(403).json({ success: false, message: 'Sai mật khẩu' });
    return false;
  }
  return true;
}

// ============== Route: Init (combined load) ==============

async function handleInit(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
  const [players, history] = await Promise.all([
    db.loadPlayers(),
    db.loadHistory(10) // Chỉ load 10 gần nhất khi khởi tạo
  ]);
  res.json({ success: true, players, history, hasMore: history.length === 10 });
}

// ============== Route: History ==============

async function handleHistory(req, res) {
  if (req.method === 'GET') return res.json({ success: true, data: await db.loadHistory() });
  if (req.method === 'DELETE') {
    if (!checkAdminPassword(req, res)) return;
    await db.clearHistory();
    return res.json({ success: true });
  }
  res.status(405).json({ success: false, message: 'Method not allowed' });
}

async function handleHistoryItem(req, res, id) {
  if (req.method !== 'DELETE') return res.status(405).json({ success: false, message: 'Method not allowed' });
  if (!id) return res.status(400).json({ success: false, message: 'Thiếu id' });
  if (!checkAdminPassword(req, res)) return;
  const ok = await db.removeHistory(id);
  if (!ok) return res.status(404).json({ success: false, message: 'Không tìm thấy lịch sử' });
  res.json({ success: true });
}

// ============== Main handler ==============

module.exports = async (req, res) => {
  try {
    // Vercel rewrites lose original URL — use query param 'route' as source of truth
    const rawUrl = req.query?.route || req.url.split('?')[0];
    const url = rawUrl.replace(/\/+$/, '');

    if (url === '/api/init') return handleInit(req, res);
    if (url === '/api/source/codes') return handleSourceCodes(req, res);
    if (url === '/api/players/bulk') return handlePlayersBulk(req, res);
    if (url === '/api/players') return handlePlayers(req, res);
    if (url === '/api/redeem/single') return handleRedeemSingle(req, res);
    if (url === '/api/redeem') return handleRedeem(req, res);
    if (url === '/api/history') return handleHistory(req, res);
    if (url.startsWith('/api/history/')) return handleHistoryItem(req, res, url.slice('/api/history/'.length));
    res.status(404).json({ success: false, message: 'Not found' });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
};
