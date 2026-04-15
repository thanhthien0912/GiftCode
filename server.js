const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database file path
const DB_FILE = path.join(__dirname, 'data', 'players.json');
const HISTORY_FILE = path.join(__dirname, 'data', 'history.json');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

// Load/Save helpers
function loadPlayers() {
  if (!fs.existsSync(DB_FILE)) return [];
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

function savePlayers(players) {
  fs.writeFileSync(DB_FILE, JSON.stringify(players, null, 2));
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// ============== API ROUTES ==============

// Get all players
app.get('/api/players', (req, res) => {
  const players = loadPlayers();
  res.json({ success: true, data: players });
});

// Add a player
app.post('/api/players', (req, res) => {
  const { roleId, roleName, serverId } = req.body;
  if (!roleId) {
    return res.status(400).json({ success: false, message: 'roleId là bắt buộc' });
  }

  const players = loadPlayers();
  
  // Check duplicate
  if (players.find(p => p.roleId === roleId && p.serverId === (serverId || '2'))) {
    return res.status(400).json({ success: false, message: 'Người chơi này đã tồn tại' });
  }

  const player = {
    id: uuidv4(),
    roleId: roleId.trim(),
    roleName: (roleName || roleId).trim(),
    serverId: serverId || '2',
    createdAt: new Date().toISOString()
  };

  players.push(player);
  savePlayers(players);
  res.json({ success: true, data: player });
});

// Delete a player
app.delete('/api/players/:id', (req, res) => {
  let players = loadPlayers();
  const before = players.length;
  players = players.filter(p => p.id !== req.params.id);
  
  if (players.length === before) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy người chơi' });
  }

  savePlayers(players);
  res.json({ success: true });
});

// Import multiple players (bulk)
app.post('/api/players/bulk', (req, res) => {
  const { roleIds, players: playerEntries, serverId } = req.body;

  // Support both formats:
  // Old: { roleIds: ["id1", "id2"], serverId }
  // New: { players: [{ roleId, roleName }], serverId }
  let entries = [];
  if (playerEntries && Array.isArray(playerEntries)) {
    entries = playerEntries.map(p => ({
      roleId: (p.roleId || '').trim(),
      roleName: (p.roleName || p.roleId || '').trim()
    })).filter(p => p.roleId);
  } else if (roleIds && Array.isArray(roleIds)) {
    entries = roleIds.map(rid => ({
      roleId: rid.trim(),
      roleName: rid.trim()
    })).filter(p => p.roleId);
  }

  if (entries.length === 0) {
    return res.status(400).json({ success: false, message: 'Danh sách người chơi không hợp lệ' });
  }

  const players = loadPlayers();
  const added = [];
  const skipped = [];

  for (const entry of entries) {
    if (players.find(p => p.roleId === entry.roleId && p.serverId === (serverId || '2'))) {
      skipped.push(entry.roleId);
      continue;
    }

    const player = {
      id: uuidv4(),
      roleId: entry.roleId,
      roleName: entry.roleName || entry.roleId,
      serverId: serverId || '2',
      createdAt: new Date().toISOString()
    };
    players.push(player);
    added.push(entry.roleId);
  }

  savePlayers(players);
  res.json({ success: true, added: added.length, skipped: skipped.length, details: { added, skipped } });
});

// ============== REDEEM CODE ==============

// Redeem code for ALL players
app.post('/api/redeem', async (req, res) => {
  const { code, delayMs } = req.body;
  if (!code || !code.trim()) {
    return res.status(400).json({ success: false, message: 'Code không được để trống' });
  }

  const players = loadPlayers();
  if (players.length === 0) {
    return res.status(400).json({ success: false, message: 'Chưa có người chơi nào trong danh sách' });
  }

  const results = [];
  const delay = Math.max(delayMs || 1000, 500); // Min 500ms between requests

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

      results.push({
        roleId: player.roleId,
        roleName: player.roleName,
        serverId: player.serverId,
        ...result
      });
    } catch (err) {
      results.push({
        roleId: player.roleId,
        roleName: player.roleName,
        serverId: player.serverId,
        success: false,
        errorCode: -1,
        message: err.message
      });
    }

    // Delay between requests to avoid rate limiting
    if (i < players.length - 1) {
      await sleep(delay);
    }
  }

  // Save to history
  const history = loadHistory();
  history.unshift({
    id: uuidv4(),
    code: code.trim(),
    timestamp: new Date().toISOString(),
    totalPlayers: players.length,
    successCount: results.filter(r => r.success).length,
    failCount: results.filter(r => !r.success).length,
    results
  });

  // Keep only last 100 entries
  if (history.length > 100) history.length = 100;
  saveHistory(history);

  const successCount = results.filter(r => r.success).length;
  res.json({
    success: true,
    code: code.trim(),
    total: players.length,
    successCount,
    failCount: players.length - successCount,
    results
  });
});

// Redeem code for a specific player
app.post('/api/redeem/single', async (req, res) => {
  const { code, roleId, roleName, serverId } = req.body;
  if (!code || !roleId) {
    return res.status(400).json({ success: false, message: 'Code và roleId là bắt buộc' });
  }

  try {
    const result = await redeemCode({
      code: code.trim(),
      roleId,
      roleName: roleName || roleId,
      serverId: serverId || '2',
      gameCode: '661'
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.json({ success: false, errorCode: -1, message: err.message });
  }
});

// Get history
app.get('/api/history', (req, res) => {
  const history = loadHistory();
  res.json({ success: true, data: history });
});

// Clear history
app.delete('/api/history', (req, res) => {
  saveHistory([]);
  res.json({ success: true });
});

// ============== VNG API HELPER ==============

// Error code mapping from VNG
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
  const body = JSON.stringify({
    serverId,
    gameCode,
    roleId,
    roleName,
    code
  });

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============== START SERVER ==============
app.listen(PORT, () => {
  console.log(`🎮 VNG Giftcode Bot đang chạy tại http://localhost:${PORT}`);
  console.log(`📋 Mở trình duyệt để quản lý danh sách người chơi và nhập code`);
});
