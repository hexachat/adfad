const supabase = require('../config/supabase');
const { socketAuth } = require('../middleware/auth');

const onlineUsers = new Map();

function setupSocketHandlers(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    const userId = socketAuth(token);
    if (!userId) return next(new Error('Unauthorized'));
    socket.userId = userId;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    onlineUsers.set(userId, socket.id);
    socket.join(`user:${userId}`);

    supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', userId);
    io.emit('user_online', { userId });

    socket.on('join_group', (groupId) => {
      socket.join(`group:${groupId}`);
    });

    socket.on('typing', ({ chatId, isGroup }) => {
      const room = isGroup ? `group:${chatId}` : `user:${chatId}`;
      socket.to(room).emit('typing', { userId, chatId });
    });

    socket.on('stop_typing', ({ chatId, isGroup }) => {
      const room = isGroup ? `group:${chatId}` : `user:${chatId}`;
      socket.to(room).emit('stop_typing', { userId, chatId });
    });

    // WebRTC Signaling
    socket.on('call_user', async ({ receiverId, callType, callId }) => {
      const { data: caller } = await supabase
        .from('users')
        .select('id, name, phone_number, profile_photo')
        .eq('id', userId)
        .single();

      const { data: callRecord } = await supabase
        .from('call_history')
        .insert({
          id: callId,
          caller_id: userId,
          receiver_id: receiverId,
          call_type: callType || 'voice',
          status: 'missed'
        })
        .select()
        .single();

      const receiverSocket = onlineUsers.get(receiverId);
      if (receiverSocket) {
        io.to(receiverSocket).emit('incoming_call', {
          caller,
          callType,
          callId: callRecord?.id || callId
        });
      } else {
        socket.emit('call_unavailable', { callId });
      }
    });

    socket.on('answer_call', ({ callerId, callId }) => {
      const callerSocket = onlineUsers.get(callerId);
      if (callerSocket) {
        io.to(callerSocket).emit('call_answered', { userId, callId });
      }
      supabase.from('call_history').update({ status: 'answered' }).eq('id', callId);
    });

    socket.on('decline_call', ({ callerId, callId }) => {
      const callerSocket = onlineUsers.get(callerId);
      if (callerSocket) {
        io.to(callerSocket).emit('call_declined', { callId });
      }
      supabase.from('call_history').update({ status: 'declined', ended_at: new Date().toISOString() }).eq('id', callId);
    });

    socket.on('end_call', ({ otherUserId, callId, duration }) => {
      const otherSocket = onlineUsers.get(otherUserId);
      if (otherSocket) {
        io.to(otherSocket).emit('call_ended', { callId });
      }
      if (callId) {
        supabase.from('call_history').update({
          status: 'answered',
          duration: duration || 0,
          ended_at: new Date().toISOString()
        }).eq('id', callId);
      }
    });

    socket.on('webrtc_offer', ({ targetUserId, offer, callId }) => {
      const targetSocket = onlineUsers.get(targetUserId);
      if (targetSocket) {
        io.to(targetSocket).emit('webrtc_offer', { offer, callerId: userId, callId });
      }
    });

    socket.on('webrtc_answer', ({ targetUserId, answer, callId }) => {
      const targetSocket = onlineUsers.get(targetUserId);
      if (targetSocket) {
        io.to(targetSocket).emit('webrtc_answer', { answer, userId, callId });
      }
    });

    socket.on('webrtc_ice_candidate', ({ targetUserId, candidate }) => {
      const targetSocket = onlineUsers.get(targetUserId);
      if (targetSocket) {
        io.to(targetSocket).emit('webrtc_ice_candidate', { candidate, userId });
      }
    });

    socket.on('disconnect', () => {
      onlineUsers.delete(userId);
      supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', userId);
      io.emit('user_offline', { userId });
    });
  });
}

module.exports = { setupSocketHandlers, onlineUsers };
