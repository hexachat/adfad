const onlineUsers = new Map();

function setupSocket(io) {
  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('register', (userId) => {
      onlineUsers.set(userId, socket.id);
      socket.userId = userId;
      socket.join(`user_${userId}`);
      io.emit('user_online', { userId });
    });

    socket.on('join_conversation', (conversationId) => {
      socket.join(`conv_${conversationId}`);
    });

    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conv_${conversationId}`);
    });

    // Real-time messaging
    socket.on('send_message', (data) => {
      io.to(`conv_${data.conversation_id}`).emit('new_message', data);
    });

    socket.on('typing', (data) => {
      socket.to(`conv_${data.conversationId}`).emit('user_typing', {
        userId: socket.userId,
        conversationId: data.conversationId
      });
    });

    socket.on('stop_typing', (data) => {
      socket.to(`conv_${data.conversationId}`).emit('user_stop_typing', {
        userId: socket.userId
      });
    });

    // WebRTC Signaling
    socket.on('call_user', (data) => {
      const { targetUserId, callerId, callerName, callerPhoto, callType, callId } = data;
      const targetSocketId = onlineUsers.get(targetUserId);

      if (targetSocketId) {
        io.to(targetSocketId).emit('incoming_call', {
          callerId, callerName, callerPhoto, callType, callId
        });
      } else {
        socket.emit('call_failed', { reason: 'User offline', callId });
      }
    });

    socket.on('call_answer', (data) => {
      const { targetUserId, callId, answer } = data;
      const targetSocketId = onlineUsers.get(targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call_answered', { callId, answer, answererId: socket.userId });
      }
    });

    socket.on('call_decline', (data) => {
      const { targetUserId, callId } = data;
      const targetSocketId = onlineUsers.get(targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call_declined', { callId });
      }
    });

    socket.on('call_end', (data) => {
      const { targetUserId, callId } = data;
      const targetSocketId = onlineUsers.get(targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call_ended', { callId });
      }
    });

    socket.on('webrtc_offer', (data) => {
      const targetSocketId = onlineUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc_offer', {
          offer: data.offer,
          senderId: socket.userId,
          callId: data.callId
        });
      }
    });

    socket.on('webrtc_answer', (data) => {
      const targetSocketId = onlineUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc_answer', {
          answer: data.answer,
          senderId: socket.userId,
          callId: data.callId
        });
      }
    });

    socket.on('webrtc_ice_candidate', (data) => {
      const targetSocketId = onlineUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc_ice_candidate', {
          candidate: data.candidate,
          senderId: socket.userId,
          callId: data.callId
        });
      }
    });

    // Status notifications
    socket.on('new_status', (data) => {
      io.emit('status_update', data);
    });

    socket.on('disconnect', () => {
      if (socket.userId) {
        onlineUsers.delete(socket.userId);
        io.emit('user_offline', { userId: socket.userId });
      }
      console.log('User disconnected:', socket.id);
    });
  });
}

module.exports = setupSocket;
