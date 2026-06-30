const express = require('express');
const fs = require('fs');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => {
    let ext = path.extname(file.originalname);
    if (!ext) ext = '.webm';
    cb(null, `voice-${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }
});

router.post('/send', authMiddleware, (req, res) => {
  upload.single('audio')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }

    try {
      const { receiver_id, group_id } = req.body;
      if (!req.file) {
        return res.status(400).json({ error: 'No audio file received' });
      }
      if (!receiver_id && !group_id) {
        return res.status(400).json({ error: 'Receiver or group required' });
      }

      const msg = {
        sender_id: req.user.id,
        content: 'Voice message',
        message_type: 'audio',
        media_url: `/uploads/${req.file.filename}`,
        is_read: false
      };
      if (receiver_id) msg.receiver_id = receiver_id;
      if (group_id) msg.group_id = group_id;

      const { data: message, error } = await supabase.from('messages').insert(msg).select('*').single();
      if (error) {
        console.error('Voice DB error:', error);
        return res.status(500).json({ error: error.message || 'Failed to save voice message' });
      }

      const io = req.app.get('io');
      const sender = { id: req.user.id, name: req.user.name };
      if (io) {
        if (group_id) {
          io.to(`group:${group_id}`).emit('new_message', { message, sender });
        } else if (receiver_id) {
          io.to(`user:${receiver_id}`).emit('new_message', { message, sender });
        }
      }

      res.json({ message });
    } catch (e) {
      console.error('Voice send error:', e);
      res.status(500).json({ error: 'Voice message failed' });
    }
  });
});

module.exports = router;
