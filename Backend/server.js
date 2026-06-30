require('dotenv').config();
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const supabase = require('./config/supabase');
const http = require('http');
const { loadHttpsOptions } = require('./config/https');
const { getLanIp } = require('./utils/lanIp');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const contactRoutes = require('./routes/contacts');
const messageRoutes = require('./routes/messages');
const groupRoutes = require('./routes/groups');
const statusRoutes = require('./routes/statuses');
const callRoutes = require('./routes/calls');
const voiceRoutes = require('./routes/voice');

const isProduction = !!(process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production');
const PORT = Number(process.env.PORT) || 5000;

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://hexachat.netlify.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
].filter(Boolean);

if (process.env.ALLOWED_ORIGINS) {
  allowedOrigins.push(...process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean));
}

function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  if (allowedOrigins.includes(origin)) return callback(null, true);
  if (/\.netlify\.app$/i.test(origin)) return callback(null, true);
  if (!isProduction) return callback(null, true);
  callback(null, true);
}

const app = express();
app.set('trust proxy', 1);

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true
  }
});
app.set('io', io);

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

app.get('/', (req, res) => {
  res.json({ app: 'HexaChat API', status: 'running', health: '/api/health' });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/statuses', statusRoutes);
app.use('/api/calls', callRoutes);

app.get('/api/health', async (req, res) => {
  const { error } = await supabase.from('users').select('id').limit(1);
  res.json({
    status: 'ok',
    app: 'HexaChat',
    version: '25',
    env: isProduction ? 'production' : 'development',
    database: error ? 'error' : 'connected',
    dbError: error?.message || null
  });
});

// Socket.io online users map
const onlineUsers = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Auth required'));
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', async (socket) => {
  const userId = socket.user.id;
  onlineUsers.set(userId, socket.id);

  await supabase.from('users').update({ is_online: true, last_seen: new Date().toISOString() }).eq('id', userId);
  io.emit('user_online', { userId });

  socket.join(`user:${userId}`);

  const { data: groups } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', userId);

  for (const g of (groups || [])) {
    socket.join(`group:${g.group_id}`);
  }

  socket.on('send_message', async (data) => {
    const { receiver_id, group_id, content, message_type = 'text', media_url = null } = data;
    const msg = {
      sender_id: userId,
      content: content || (message_type === 'audio' ? 'Voice message' : ''),
      message_type,
      is_read: false
    };
    if (media_url) msg.media_url = media_url;
    if (receiver_id) msg.receiver_id = receiver_id;
    if (group_id) msg.group_id = group_id;

    const { data: message } = await supabase.from('messages').insert(msg).select('*').single();
    if (!message) return;

    if (group_id) {
      io.to(`group:${group_id}`).emit('new_message', { message, sender: socket.user });
      const { data: members } = await supabase
        .from('group_members')
        .select('user_id')
        .eq('group_id', group_id)
        .neq('user_id', userId);

      for (const m of (members || [])) {
        const sid = onlineUsers.get(m.user_id);
        if (sid) {
          io.to(sid).emit('notification', {
            type: 'message',
            title: 'Group Message',
            body: content,
            data: { group_id, message_id: message.id }
          });
        }
      }
    } else if (receiver_id) {
      const receiverSocket = onlineUsers.get(receiver_id);
      if (receiverSocket) {
        io.to(receiverSocket).emit('new_message', { message, sender: socket.user });
        io.to(receiverSocket).emit('notification', {
          type: 'message',
          title: socket.user.name || 'New Message',
          body: content,
          data: { sender_id: userId, message_id: message.id }
        });
      }
      socket.emit('message_sent', { message });
    }
  });

  socket.on('typing', ({ receiver_id, group_id, isTyping }) => {
    if (receiver_id) {
      const sid = onlineUsers.get(receiver_id);
      if (sid) io.to(sid).emit('typing', { userId, isTyping });
    }
    if (group_id) {
      socket.to(`group:${group_id}`).emit('typing', { userId, isTyping });
    }
  });

  socket.on('mark_read', async ({ sender_id }) => {
    await supabase.from('messages')
      .update({ is_read: true })
      .eq('sender_id', sender_id)
      .eq('receiver_id', userId)
      .eq('is_read', false);

    const sid = onlineUsers.get(sender_id);
    if (sid) io.to(sid).emit('messages_read', { reader_id: userId });
  });

  socket.on('call_user', async ({ receiver_id, call_type, call_id }) => {
    const receiverSocket = onlineUsers.get(receiver_id);
    if (receiverSocket) {
      io.to(receiverSocket).emit('incoming_call', {
        caller_id: userId,
        caller_name: socket.user.name,
        call_type,
        call_id,
        caller_socket: socket.id
      });
    } else {
      await supabase.from('calls').insert({
        caller_id: userId,
        receiver_id,
        call_type: call_type || 'audio',
        status: 'missed',
        ended_at: new Date().toISOString()
      });
      socket.emit('call_failed', { reason: 'User offline' });
    }
  });

  socket.on('answer_call', ({ caller_id, call_id, answer }) => {
    const callerSocket = onlineUsers.get(caller_id);
    if (callerSocket) {
      io.to(callerSocket).emit('call_answered', {
        answerer_id: userId,
        call_id,
        answer,
        answerer_socket: socket.id
      });
    }
  });

  socket.on('ice_candidate', ({ target_id, candidate }) => {
    const targetSocket = onlineUsers.get(target_id);
    if (targetSocket) {
      io.to(targetSocket).emit('ice_candidate', { sender_id: userId, candidate });
    }
  });

  socket.on('end_call', async ({ target_id, call_id, duration, status }) => {
    const targetSocket = onlineUsers.get(target_id);
    if (targetSocket) {
      io.to(targetSocket).emit('call_ended', { call_id });
    }
    if (call_id) {
      await supabase.from('calls').update({
        status: status || 'ended',
        duration: duration || 0,
        ended_at: new Date().toISOString()
      }).eq('id', call_id);
    }
  });

  socket.on('decline_call', async ({ caller_id, call_id }) => {
    const callerSocket = onlineUsers.get(caller_id);
    if (callerSocket) {
      io.to(callerSocket).emit('call_declined', { call_id });
    }
    if (call_id) {
      await supabase.from('calls').update({
        status: 'declined',
        ended_at: new Date().toISOString()
      }).eq('id', call_id);
    }
  });

  socket.on('new_status', async () => {
    const { data: contacts } = await supabase
      .from('contacts')
      .select('user_id')
      .eq('contact_user_id', userId);

    for (const c of (contacts || [])) {
      const sid = onlineUsers.get(c.user_id);
      if (sid) {
        io.to(sid).emit('status_update', { userId });
      }
    }
  });

  socket.on('disconnect', async () => {
    onlineUsers.delete(userId);
    await supabase.from('users').update({
      is_online: false,
      last_seen: new Date().toISOString()
    }).eq('id', userId);
    io.emit('user_offline', { userId });
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  if (isProduction) {
    console.log(`\n  HexaChat API (Railway): listening on port ${PORT}`);
    console.log(`  Frontend: https://hexachat.netlify.app\n`);
  } else {
    const ip = getLanIp();
    console.log(`\n  HexaChat Backend (local): http://${ip}:${PORT}`);
    console.log(`  Voice API: http://${ip}:${PORT}/api/voice/send`);

    const ssl = loadHttpsOptions();
    if (ssl) {
      const https = require('https');
      https.createServer(ssl, app).listen(5443, '0.0.0.0', () => {
        console.log(`  HexaChat Backend (HTTPS): https://${ip}:5443\n`);
      });
    } else {
      console.log('');
    }
  }
});

module.exports = { io, onlineUsers };
