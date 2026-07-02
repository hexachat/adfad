require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const supabase = require('./config/supabase');

const authRoutes = require('./routes/auth');
const contactRoutes = require('./routes/contacts');
const groupRoutes = require('./routes/groups');
const messageRoutes = require('./routes/messages');
const statusRoutes = require('./routes/status');
const callRoutes = require('./routes/calls');
const uploadRoutes = require('./routes/upload');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://hexachat2.netlify.app',
  process.env.FRONTEND_URL
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/conversations', messageRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'HexaChat', time: new Date().toISOString() });
});

// Online users map: userId -> socketId
const onlineUsers = new Map();

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Auth required'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { data: user } = await supabase.from('users')
      .select('id, name, phone, avatar_url')
      .eq('id', decoded.userId).single();
    if (!user) return next(new Error('Invalid user'));
    socket.user = user;
    next();
  } catch {
    next(new Error('Auth failed'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  onlineUsers.set(userId, socket.id);
  socket.join(`user:${userId}`);

  supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', userId);
  io.emit('user:online', { userId, online: true });

  // Join conversation rooms
  socket.on('join:conversations', async (conversationIds) => {
    for (const id of conversationIds) {
      socket.join(`conv:${id}`);
    }
  });

  // Real-time messaging
  socket.on('message:send', async (data) => {
    const { conversationId, content, message_type, media_url, media_duration } = data;
    const { data: message } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: userId,
      content,
      message_type: message_type || 'text',
      media_url,
      media_duration
    }).select('*, sender:users!sender_id(id, name, phone, avatar_url)').single();

    if (message) {
      io.to(`conv:${conversationId}`).emit('message:new', message);

      // Notify participants not in room
      const { data: participants } = await supabase.from('conversation_participants')
        .select('user_id').eq('conversation_id', conversationId);

      for (const p of participants || []) {
        if (p.user_id !== userId) {
          io.to(`user:${p.user_id}`).emit('notification', {
            type: 'message',
            conversationId,
            message,
            sender: socket.user
          });
        }
      }
    }
  });

  socket.on('message:read', async ({ conversationId }) => {
    await supabase.from('messages')
      .update({ is_read: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', userId);
    io.to(`conv:${conversationId}`).emit('message:read', { conversationId, userId });
  });

  socket.on('typing:start', ({ conversationId }) => {
    socket.to(`conv:${conversationId}`).emit('typing:start', { conversationId, userId, name: socket.user.name });
  });

  socket.on('typing:stop', ({ conversationId }) => {
    socket.to(`conv:${conversationId}`).emit('typing:stop', { conversationId, userId });
  });

  // WebRTC Call Signaling
  socket.on('call:initiate', async (data) => {
    const { receiverId, callType, callId } = data;
    const receiverSocket = onlineUsers.get(receiverId);

    // Log call
    const { data: call } = await supabase.from('calls').insert({
      caller_id: userId,
      receiver_id: receiverId,
      call_type: callType,
      status: 'ringing'
    }).select('*').single();

    const callData = {
      callId: call?.id || callId,
      caller: socket.user,
      callType,
      callerSocketId: socket.id
    };

    if (receiverSocket) {
      io.to(receiverSocket).emit('call:incoming', callData);
    }
    socket.emit('call:ringing', callData);
  });

  socket.on('call:accept', ({ callId, callerSocketId }) => {
    io.to(callerSocketId).emit('call:accepted', { callId, accepterSocketId: socket.id, accepter: socket.user });
    supabase.from('calls').update({ status: 'answered', answered_at: new Date().toISOString() }).eq('id', callId);
  });

  socket.on('call:reject', ({ callId, callerSocketId }) => {
    io.to(callerSocketId).emit('call:rejected', { callId });
    supabase.from('calls').update({ status: 'rejected', ended_at: new Date().toISOString() }).eq('id', callId);
  });

  socket.on('call:end', ({ callId, otherSocketId, duration }) => {
    if (otherSocketId) io.to(otherSocketId).emit('call:ended', { callId });
    const updates = { status: 'ended', ended_at: new Date().toISOString() };
    if (duration) updates.duration = duration;
    supabase.from('calls').update(updates).eq('id', callId);
  });

  // WebRTC ICE & SDP exchange
  socket.on('webrtc:offer', ({ targetSocketId, offer, callId }) => {
    io.to(targetSocketId).emit('webrtc:offer', { offer, callId, fromSocketId: socket.id });
  });

  socket.on('webrtc:answer', ({ targetSocketId, answer, callId }) => {
    io.to(targetSocketId).emit('webrtc:answer', { answer, callId, fromSocketId: socket.id });
  });

  socket.on('webrtc:ice-candidate', ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('webrtc:ice-candidate', { candidate, fromSocketId: socket.id });
  });

  // Status updates
  socket.on('status:new', (status) => {
    socket.broadcast.emit('status:update', status);
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(userId);
    supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', userId);
    io.emit('user:online', { userId, online: false });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`HexaChat Backend running on port ${PORT}`);
});
