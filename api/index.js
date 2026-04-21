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

  const { code, delayMs } = parseBody(req);
  if (!code || !code.trim()) return res.status(400).json({ success: false, message: 'Code không được để trống' });

  const players = await db.loadPlayers();
  if (players.length === 0) return res.status(400).json({ success: false, message: 'Chưa có người chơi nào' });

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

  send({ type: 'start', total: players.length, code: code.trim() });

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    send({
      type: 'progress',
      index: i,
      current: i + 1,
      total: players.length,
      roleId: p.roleId,
      roleName: p.roleName,
      serverId: p.serverId
    });

    let entry;
    try {
      const r = await redeemCode({ code: code.trim(), roleId: p.roleId, roleName: p.roleName, serverId: p.serverId, gameCode: '661' });
      entry = { roleId: p.roleId, roleName: p.roleName, ...r };
    } catch (err) {
      entry = { roleId: p.roleId, roleName: p.roleName, success: false, errorCode: -1, message: err.message };
    }
    results.push(entry);
    send({ type: 'result', index: i, current: i + 1, total: players.length, result: entry });

    if (i < players.length - 1) await sleep(delay);
  }

  const successCount = results.filter(r => r.success).length;
  const summary = {
    success: true,
    code: code.trim(),
    total: players.length,
    successCount,
    failCount: players.length - successCount,
    results
  };

  await db.addHistory({
    id: uuidv4(),
    code: code.trim(),
    timestamp: new Date().toISOString(),
    totalPlayers: players.length,
    successCount,
    failCount: players.length - successCount,
    results
  });

  send({ type: 'done', summary });
  res.end();
}

// ============== Route: Redeem Single ==============

async function handleRedeemSingle(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const { code, roleId, roleName, serverId } = parseBody(req);
  if (!code || !roleId) return res.status(400).json({ success: false, message: 'Code và roleId là bắt buộc' });

  try {
    const result = await redeemCode({ code: code.trim(), roleId, roleName: roleName || roleId, serverId: serverId || '2', gameCode: '661' });
    res.json({ success: true, ...result });
  } catch (err) {
    res.json({ success: false, errorCode: -1, message: err.message });
  }
}

// ============== Route: History ==============

async function handleHistory(req, res) {
  if (req.method === 'GET') return res.json({ success: true, data: await db.loadHistory() });
  if (req.method === 'DELETE') { await db.clearHistory(); return res.json({ success: true }); }
  res.status(405).json({ success: false, message: 'Method not allowed' });
}

// ============== Route: Export ==============

async function handleExport(req, res) {
  const data = {
    exportedAt: new Date().toISOString(),
    players: await db.loadPlayers(),
    history: await db.loadHistory()
  };
  res.setHeader('Content-Disposition', `attachment; filename="giftcode-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

// ============== Route: Import ==============

async function handleImport(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const { players, history } = parseBody(req);
  if (!players && !history) {
    return res.status(400).json({ success: false, message: 'File backup không hợp lệ. Cần có "players" hoặc "history".' });
  }

  try {
    if (Array.isArray(players)) await db.savePlayers(players);
    if (Array.isArray(history)) await db.saveHistory(history.slice(0, 100));

    const currentPlayers = await db.loadPlayers();
    const currentHistory = await db.loadHistory();

    res.json({
      success: true,
      message: 'Import thành công',
      playerCount: currentPlayers.length,
      historyCount: currentHistory.length
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi import: ' + err.message });
  }
}

// ============== Main handler ==============

module.exports = async (req, res) => {
  try {
    // Vercel rewrites lose original URL — use query param 'route' as source of truth
    const rawUrl = req.query?.route || req.url.split('?')[0];
    const url = rawUrl.replace(/\/+$/, '');

    if (url === '/api/players/bulk') return handlePlayersBulk(req, res);
    if (url.startsWith('/api/players/')) return handlePlayers(req, res);
    if (url === '/api/players') return handlePlayers(req, res);
    if (url === '/api/redeem/single') return handleRedeemSingle(req, res);
    if (url === '/api/redeem') return handleRedeem(req, res);
    if (url === '/api/history') return handleHistory(req, res);
    if (url === '/api/export') return handleExport(req, res);
    if (url === '/api/import') return handleImport(req, res);

    res.status(404).json({ success: false, message: 'Not found' });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
};
