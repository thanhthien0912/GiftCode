const express = require('express');
const path = require('path');
const handler = require('./api/index');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.all(/^\/api(?:\/.*)?$/, (req, res) => handler(req, res));

app.listen(PORT, () => {
  console.log(`🎮 GiftCode Bot → http://localhost:${PORT}`);
});
