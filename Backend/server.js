const express = require('express');
const http = require('http');
const https = require('https');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
require('dotenv').config();

const supabase = require('./config/supabase');
const { formatUser, USER_PUBLIC_SELECT, fetchUserById } = require('./config/user-fields');
const { addCall } = require('./store/call-store');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const contactRoutes = require('./routes/contacts');
const groupRoutes = require('./routes/groups');
const messageRoutes = require('./routes/messages');
const statusRoutes = require('./routes/status');
const callRoutes = require('./routes/calls');
const { getIceServerConfig, getIceServerConfigSync } = require('./lib/webrtc-ice');

function getAllowedOrigins() {
  const defaults = [
    'https://hexachat2.netlify.app',
    'http://localhost:3000',
    'https://localhost:3000',
    'http://127.0.0.1:3000',
    'https://127.0.0.1:3000'
  ];
  const raw = process.env.FRONTEND_URL || defaults.join(',');
  const fromEnv = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...defaults, ...fromEnv])];
}

const allowedOrigins = getAllowedOrigins();

function corsOrigin(origin, callback) {
  if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    callback(null, true);
    return;
  }
  if (
    /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|101\.101\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(
      origin
    )
  ) {
    callback(null, true);
    return;
  }
  callback(null, allowedOrigins[0]);
}

const app = express();
const useLocalHttps = process.env.USE_LOCAL_HTTPS === 'true';

let server;
if (useLocalHttps) {
  const { ensureCerts } = require('./lib/https-certs');
  server = https.createServer(ensureCerts(), app);
} else {
  server = http.createServer(app);
}

const io = new Server(server, {
  cors: {
    origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 120000,
  pingInterval: 25000,
  connectTimeout: 45000,
  transports: ['websocket', 'polling']
});

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'microphone=*, camera=*');
  next();
});
app.use(express.json());

const uploadsDir = path.join(__dirname, 'uploads');
const statusUploadsDir = path.join(uploadsDir, 'status');
const dataDir = path.join(__dirname, 'data');
[uploadsDir, statusUploadsDir, dataDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use('/uploads', express.static(uploadsDir));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/calls', callRoutes);

app.get('/', (_, res) => {
  res.json({
    app: 'HexaChat API',
    status: 'running',
    health: '/api/health',
    frontend: process.env.FRONTEND_URL || 'https://hexachat2.netlify.app'
  });
});

app.get('/api/health', (_, res) => res.json({ status: 'ok', app: 'HexaChat' }));

app.get('/api/webrtc/ice', async (_, res) => {
  try {
    const config = await getIceServerConfig();
    res.json(config);
  } catch (err) {
    console.error('ICE config error:', err);
    res.json(getIceServerConfigSync());
  }
});

app.get('/api/network', (_, res) => {
  if (useLocalHttps) {
    const { getLanIp } = require('./lib/https-certs');
    const ip = getLanIp();
    res.json({
      lan_ip: ip,
      frontend: `https://${ip}:3000`,
      backend: `https://${ip}:5000`,
      secure_context: true
    });
    return;
  }
  res.json({
    mode: 'production',
    backend: process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : 'Railway',
    frontend: process.env.FRONTEND_URL || 'https://hexachat2.netlify.app'
  });
});

const onlineUsers = new Map();
const callSessions = new Map();

function addOnlineUser(userId, socketId) {
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socketId);
}

function removeOnlineUser(userId, socketId) {
  const set = onlineUsers.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (!set.size) onlineUsers.delete(userId);
}

function emitToUser(userId, event, data) {
  const sockets = onlineUsers.get(userId);
  if (!sockets) return;
  for (const sid of sockets) {
    io.to(sid).emit(event, data);
  }
}

function clearCallSession(userId) {
  const session = callSessions.get(userId);
  if (!session) return;
  callSessions.delete(userId);
  callSessions.delete(session.with);
}

function setCallSession(userA, userB) {
  callSessions.set(userA, { with: userB });
  callSessions.set(userB, { with: userA });
}

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Unauthorized'));
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  addOnlineUser(userId, socket.id);
  io.emit('user_online', { userId });
  socket.emit('online_users', { userIds: Array.from(onlineUsers.keys()) });

  socket.on('send_message', async (data, callback) => {
    try {
      const { receiver_id, group_id, content, message_type } = data;
      if (!content || (!receiver_id && !group_id)) {
        if (callback) callback({ success: false, error: 'Invalid message data' });
        return;
      }

      const insert = {
        sender_id: userId,
        content: String(content).trim(),
        message_type: message_type || 'text'
      };
      
      if (group_id) insert.group_id = group_id;
      else insert.receiver_id = receiver_id;

      const { data: message, error } = await supabase
        .from('messages')
        .insert(insert)
        .select('*')
        .single();

      if (error) {
        console.error('Message insert error:', error);
        throw error;
      }

      message.sender = await fetchUserById(supabase, userId);

      if (group_id) {
        const { data: members } = await supabase
          .from('group_members')
          .select('user_id')
          .eq('group_id', group_id);

        for (const m of members || []) {
          emitToUser(m.user_id, 'new_message', { message, group_id });
          if (m.user_id !== userId) {
            emitToUser(m.user_id, 'notification', {
              type: 'message',
              title: message.sender?.name || 'HexaChat',
              body: content,
              group_id
            });
          }
        }
      } else {
        emitToUser(receiver_id, 'new_message', { message, sender_id: userId });
        emitToUser(receiver_id, 'notification', {
          type: 'message',
          title: message.sender?.name || 'HexaChat',
          body: content,
          sender_id: userId
        });
      }

      if (callback) callback({ success: true, message });
    } catch (err) {
      console.error('Send message error:', err);
      if (callback) callback({ success: false, error: err.message || 'Failed to send' });
    }
  });

  socket.on('typing', ({ receiver_id, group_id, isTyping }) => {
    if (group_id) {
      socket.broadcast.emit('user_typing', { userId, group_id, isTyping });
    } else if (receiver_id) {
      emitToUser(receiver_id, 'user_typing', { userId, isTyping });
    }
  });

  socket.on('call_user', async ({ receiver_id, call_type, offer }) => {
    try {
      if (!receiver_id || receiver_id === userId || !offer?.sdp) {
        socket.emit('call_unavailable', { receiver_id });
        return;
      }

      if (callSessions.has(userId)) {
        socket.emit('call_busy', { receiver_id });
        return;
      }
      if (callSessions.has(receiver_id)) {
        socket.emit('call_busy', { receiver_id });
        return;
      }

      const receiverSockets = onlineUsers.get(receiver_id);
      if (!receiverSockets || !receiverSockets.size) {
        socket.emit('call_unavailable', { receiver_id });
        return;
      }

      const caller = await fetchUserById(supabase, userId);
      setCallSession(userId, receiver_id);

      emitToUser(receiver_id, 'incoming_call', {
        caller,
        call_type: call_type || 'audio',
        offer,
        caller_id: userId
      });
      socket.emit('call_ringing', { receiver_id });
    } catch (err) {
      console.error('call_user error:', err);
      clearCallSession(userId);
      socket.emit('call_unavailable', { receiver_id });
    }
  });

  socket.on('call_answer', ({ caller_id, answer }) => {
    if (!caller_id || !answer?.sdp) return;
    emitToUser(caller_id, 'call_answered', { answer, receiver_id: userId });
  });

  socket.on('call_busy', ({ caller_id }) => {
    if (caller_id) {
      clearCallSession(caller_id);
      emitToUser(caller_id, 'call_busy', { receiver_id: userId });
    }
  });

  socket.on('ice_candidate', ({ target_id, candidate }) => {
    if (target_id && candidate) {
      emitToUser(target_id, 'ice_candidate', { candidate, from_id: userId });
    }
  });

  socket.on('call_reject', ({ caller_id }) => {
    clearCallSession(userId);
    if (caller_id) emitToUser(caller_id, 'call_rejected', { receiver_id: userId });
  });

  socket.on('call_end', async ({ other_id, caller_id, receiver_id, call_type, duration, status, answered_at, started_at }) => {
    const peerId = other_id || callSessions.get(userId)?.with;
    if (peerId) {
      emitToUser(peerId, 'call_ended', { from_id: userId });
    }
    clearCallSession(userId);

    const now = new Date().toISOString();
    const callRecord = {
      caller_id: caller_id || userId,
      receiver_id: receiver_id || other_id,
      call_type: call_type || 'audio',
      status: status || 'completed',
      duration: duration || 0,
      started_at: started_at || now,
      answered_at: answered_at || (status === 'completed' && duration > 0 ? now : null),
      ended_at: now
    };

    const { error: callErr } = await supabase.from('call_history').insert(callRecord);
    if (callErr) addCall(callRecord);
  });

  socket.on('new_status', (status) => {
    socket.broadcast.emit('status_update', status);
  });

  socket.on('status_reaction', ({ status_id, reaction, user }) => {
    socket.broadcast.emit('status_reaction_update', { status_id, reaction, user });
  });

  socket.on('disconnect', () => {
    const session = callSessions.get(userId);
    if (session?.with) {
      emitToUser(session.with, 'call_ended', { from_id: userId, reason: 'disconnect' });
      clearCallSession(userId);
    }
    removeOnlineUser(userId, socket.id);
    if (!onlineUsers.has(userId)) io.emit('user_offline', { userId });
  });
});

const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || '0.0.0.0';

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. On Railway the app starts automatically on deploy — do not run "npm start" again in the shell.`
    );
  } else {
    console.error('Server failed to start:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const mode = useLocalHttps ? 'local HTTPS' : 'production HTTP';
  console.log(`HexaChat Backend running (${mode}) on port ${PORT}`);
  console.log(`Health: /api/health`);
  if (useLocalHttps) {
    const { getLanIp } = require('./lib/https-certs');
    console.log(`LAN: https://${getLanIp()}:${PORT}`);
  } else if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    console.log(`Public: https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
  }
  console.log(`CORS allowed: ${allowedOrigins.join(', ')}`);
});
