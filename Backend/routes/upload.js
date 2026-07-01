const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

router.post('/profile-photo', auth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const fileBuffer = fs.readFileSync(req.file.path);
    const fileName = `profile-${req.user.id}-${Date.now()}${path.extname(req.file.originalname)}`;

    const { data, error } = await supabase.storage
      .from('profile-photos')
      .upload(fileName, fileBuffer, { contentType: req.file.mimetype, upsert: true });

    if (error) {
      const url = `/uploads/${req.file.filename}`;
      await supabase.from('users').update({ profile_photo: url }).eq('id', req.user.id);
      return res.json({ url });
    }

    const { data: urlData } = supabase.storage.from('profile-photos').getPublicUrl(data.path);
    await supabase.from('users').update({ profile_photo: urlData.publicUrl }).eq('id', req.user.id);

    fs.unlinkSync(req.file.path);
    res.json({ url: urlData.publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/chat-media', auth, upload.single('media'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const fileBuffer = fs.readFileSync(req.file.path);
    const fileName = `chat-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(req.file.originalname)}`;

    const { data, error } = await supabase.storage
      .from('chat-media')
      .upload(fileName, fileBuffer, { contentType: req.file.mimetype });

    if (error) {
      const url = `/uploads/${req.file.filename}`;
      return res.json({ url, type: req.file.mimetype });
    }

    const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(data.path);
    fs.unlinkSync(req.file.path);
    res.json({ url: urlData.publicUrl, type: req.file.mimetype });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/status-media', auth, upload.single('media'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const fileBuffer = fs.readFileSync(req.file.path);
    const fileName = `status-${Date.now()}${path.extname(req.file.originalname)}`;

    const { data, error } = await supabase.storage
      .from('status-media')
      .upload(fileName, fileBuffer, { contentType: req.file.mimetype });

    if (error) {
      const url = `/uploads/${req.file.filename}`;
      return res.json({ url });
    }

    const { data: urlData } = supabase.storage.from('status-media').getPublicUrl(data.path);
    fs.unlinkSync(req.file.path);
    res.json({ url: urlData.publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
