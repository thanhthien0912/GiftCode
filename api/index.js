const crypto = require('crypto');
const db = require('./db');

function uuidv4() { return crypto.randomUUID(); }
// ============== VNG API HELPER ==============
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
  const body = JSON.stringify({ serverId, gameCode, roleId, roleName, code });
  const response = await fetch('https://vgrapi-sea.vnggames.com/coordinator/api/v1/code/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'X-Client-Region': 'VN',
      'x-request-id': uuidv4(),
      'Origin': 'https://giftcode.vnggames.com',
      'Referer': 'https://giftcode.vnggames.com/'
    },
    body
  });
  const data = await response.json();
  return {
    success: data.errorCode === 1,
    errorCode: data.errorCode,
    message: ERROR_MESSAGES[data.errorCode] || data.message || data.description || 'Lỗi không xác định',
    rawResponse: data
  };
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ============== Parse body ==============
function parseBody(req) {
  // Vercel auto-parses JSON body; Express also parses via middleware
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

// ============== Route handlers ==============

async function handlePlayers(req, res) {
  if (req.method === 'GET') {
    const players = await db.loadPlayers();
    return res.json({ success: true, data: players });
  }

  if (req.method === 'POST') {
    const body = await parseBody(req);
    const { roleId, roleName, serverId } = body;
    if (!roleId) return res.status(400).json({ success: false, message: 'roleId là bắt buộc' });

    const players = await db.loadPlayers();
    const sid = serverId || '2';

    if (players.find(p => p.roleId === roleId.trim() && p.serverId === sid)) {
      return res.status(400).json({ success: false, message: 'Người chơi này đã tồn tại' });
    }

    const player = {
      id: uuidv4(),
      roleId: roleId.trim(),
      roleName: (roleName || roleId).trim(),
      serverId: sid,
      createdAt: new Date().toISOString()
    };
    players.push(player);
    await db.savePlayers(players);
    return res.json({ success: true, data: player });
  }

  if (req.method === 'DELETE') {
    const id = req.url.split('/').pop();
    let players = await db.loadPlayers();
    const before = players.length;
    players = players.filter(p => p.id !== id);
    if (players.length === before) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người chơi' });
    }
    await db.savePlayers(players);
    return res.json({ success: true });
  }

  res.status(405).json({ success: false, message: 'Method not allowed' });
}

async function handlePlayersBulk(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const body = await parseBody(req);
  const { roleIds, players: playerEntries, serverId } = body;

  let entries = [];
  if (playerEntries && Array.isArray(playerEntries)) {
    entries = playerEntries.map(p => ({
      roleId: (p.roleId || '').trim(),
      roleName: (p.roleName || p.roleId || '').trim()
    })).filter(p => p.roleId);
  } else if (roleIds && Array.isArray(roleIds)) {
    entries = roleIds.map(rid => ({ roleId: rid.trim(), roleName: rid.trim() })).filter(p => p.roleId);
  }

  if (entries.length === 0) {
    return res.status(400).json({ success: false, message: 'Danh sách người chơi không hợp lệ' });
  }

  const players = await db.loadPlayers();
  const sid = serverId || '2';
  const added = [];
  const skipped = [];

  for (const entry of entries) {
    if (players.find(p => p.roleId === entry.roleId && p.serverId === sid)) {
      skipped.push(entry.roleId);
      continue;
    }
    players.push({
      id: uuidv4(),
      roleId: entry.roleId,
      roleName: entry.roleName || entry.roleId,
      serverId: sid,
      createdAt: new Date().toISOString()
    });
    added.push(entry.roleId);
  }

  await db.savePlayers(players);
  res.json({ success: true, added: added.length, skipped: skipped.length, details: { added, skipped } });
}

async function handleRedeem(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const body = await parseBody(req);
  const { code, delayMs } = body;
  if (!code || !code.trim()) {
    return res.status(400).json({ success: false, message: 'Code không được để trống' });
  }

  const players = await db.loadPlayers();
  if (players.length === 0) {
    return res.status(400).json({ success: false, message: 'Chưa có người chơi nào trong danh sách' });
  }

  const results = [];
  const delay = Math.max(delayMs || 1000, 500);

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    try {
      const result = await redeemCode({
        code: code.trim(),
        roleId: player.roleId,
        roleName: player.roleName,
        serverId: player.serverId,
        gameCode: '661'
      });
      results.push({ roleId: player.roleId, roleName: player.roleName, serverId: player.serverId, ...result });
    } catch (err) {
      results.push({ roleId: player.roleId, roleName: player.roleName, serverId: player.serverId, success: false, errorCode: -1, message: err.message });
    }
    if (i < players.length - 1) await sleep(delay);
  }

  const history = await db.loadHistory();
  const successCount = results.filter(r => r.success).length;
  history.unshift({
    id: uuidv4(), code: code.trim(), timestamp: new Date().toISOString(),
    totalPlayers: players.length, successCount, failCount: players.length - successCount, results
  });
  if (history.length > 100) history.length = 100;
  await db.saveHistory(history);

  res.json({ success: true, code: code.trim(), total: players.length, successCount, failCount: players.length - successCount, results });
}

async function handleRedeemSingle(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const body = await parseBody(req);
  const { code, roleId, roleName, serverId } = body;
  if (!code || !roleId) {
    return res.status(400).json({ success: false, message: 'Code và roleId là bắt buộc' });
  }

  try {
    const result = await redeemCode({ code: code.trim(), roleId, roleName: roleName || roleId, serverId: serverId || '2', gameCode: '661' });
    res.json({ success: true, ...result });
  } catch (err) {
    res.json({ success: false, errorCode: -1, message: err.message });
  }
}

async function handleHistory(req, res) {
  if (req.method === 'GET') {
    const history = await db.loadHistory();
    return res.json({ success: true, data: history });
  }
  if (req.method === 'DELETE') {
    await db.saveHistory([]);
    return res.json({ success: true });
  }
  res.status(405).json({ success: false, message: 'Method not allowed' });
}

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

// ============== Main handler (Vercel serverless) ==============
module.exports = async (req, res) => {
  try {
    const url = req.url.split('?')[0].replace(/\/+$/, '');

    if (url === '/api/players/bulk') return handlePlayersBulk(req, res);
    if (url.startsWith('/api/players')) return handlePlayers(req, res);
    if (url === '/api/redeem/single') return handleRedeemSingle(req, res);
    if (url === '/api/redeem') return handleRedeem(req, res);
    if (url === '/api/history') return handleHistory(req, res);
    if (url === '/api/export') return handleExport(req, res);

    res.status(404).json({ success: false, message: 'Not found' });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
  }
};
