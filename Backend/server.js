require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const contactRoutes = require('./routes/contacts');
const groupRoutes = require('./routes/groups');
const messageRoutes = require('./routes/messages');
const statusRoutes = require('./routes/status');
const callRoutes = require('./routes/calls');
const uploadRoutes = require('./routes/upload');
const setupSocket = require('./socket/socketHandler');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  'http://localhost:3000',
  'https://hexachat2.netlify.app',
  process.env.FRONTEND_URL
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'HexaChat', version: '1.0.0' });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/upload', uploadRoutes);

setupSocket(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`HexaChat Backend running on port ${PORT}`);
});
