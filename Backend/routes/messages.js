const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const router = require('express').Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    let ext = path.extname(file.originalname);
    if (!ext) {
      if (file.mimetype?.includes('mp4')) ext = '.mp4';
      else if (file.mimetype?.includes('ogg')) ext = '.ogg';
      else ext = '.webm';
    }
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype?.startsWith('audio/') || file.fieldname === 'audio') cb(null, true);
    else cb(new Error('Audio only'));
  }
});

// Get chat list (contacts + groups with last message)
router.get('/list', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  // Get contacts with last message
  const { data: contacts } = await supabase
    .from('contacts')
    .select(`
      id, created_at,
      contact:contact_user_id (id, name, phone_number, profile_photo, is_online, last_seen)
    `)
    .eq('user_id', userId);

  const chatList = [];

  for (const c of (contacts || [])) {
    const contactId = c.contact.id;
    const { data: lastMsg } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${contactId}),and(sender_id.eq.${contactId},receiver_id.eq.${userId})`)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { count: unread } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('sender_id', contactId)
      .eq('receiver_id', userId)
      .eq('is_read', false);

    chatList.push({
      type: 'contact',
      id: contactId,
      contact_id: c.id,
      name: c.contact.name,
      phone_number: c.contact.phone_number,
      profile_photo: c.contact.profile_photo,
      is_online: c.contact.is_online,
      last_seen: c.contact.last_seen,
      last_message: lastMsg || null,
      unread_count: unread || 0
    });
  }

  // Get groups
  const { data: groupMemberships } = await supabase
    .from('group_members')
    .select(`
      group_id,
      groups (id, name, profile_photo, created_at)
    `)
    .eq('user_id', userId);

  for (const gm of (groupMemberships || [])) {
    const group = gm.groups;
    const { data: lastMsg } = await supabase
      .from('messages')
      .select('*')
      .eq('group_id', group.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    chatList.push({
      type: 'group',
      id: group.id,
      name: group.name,
      profile_photo: group.profile_photo,
      last_message: lastMsg || null,
      unread_count: 0
    });
  }

  chatList.sort((a, b) => {
    const aTime = a.last_message?.created_at || '1970';
    const bTime = b.last_message?.created_at || '1970';
    return new Date(bTime) - new Date(aTime);
  });

  res.json({ chats: chatList });
});

// Upload voice message
router.post('/voice', authMiddleware, upload.single('audio'), async (req, res) => {
  try {
    const { receiver_id, group_id, duration = 0 } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No audio file received' });
    if (!receiver_id && !group_id) return res.status(400).json({ error: 'Receiver or group required' });

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
      console.error('Voice insert error:', error);
      return res.status(500).json({ error: error.message || 'Failed to save voice message' });
    }

    const io = req.app.get('io');
    const sender = { id: req.user.id, name: req.user.name, phone_number: req.user.phone_number };
    if (io) {
      if (group_id) {
        io.to(`group:${group_id}`).emit('new_message', { message, sender });
      } else if (receiver_id) {
        io.to(`user:${receiver_id}`).emit('new_message', { message, sender });
        io.to(`user:${req.user.id}`).emit('new_message', { message, sender });
      }
    }

    res.json({ message });
  } catch (err) {
    console.error('Voice upload error:', err);
    res.status(500).json({ error: 'Voice message failed' });
  }
});

// Get messages with a contact
router.get('/:contactId', authMiddleware, async (req, res) => {
  const { contactId } = req.params;
  const userId = req.user.id;

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .or(`and(sender_id.eq.${userId},receiver_id.eq.${contactId}),and(sender_id.eq.${contactId},receiver_id.eq.${userId})`)
    .order('created_at', { ascending: true });

  // Mark as read
  await supabase.from('messages')
    .update({ is_read: true })
    .eq('sender_id', contactId)
    .eq('receiver_id', userId)
    .eq('is_read', false);

  res.json({ messages: messages || [] });
});

// Get group messages
router.get('/group/:groupId', authMiddleware, async (req, res) => {
  const { groupId } = req.params;

  const { data: member } = await supabase
    .from('group_members')
    .select('id')
    .eq('group_id', groupId)
    .eq('user_id', req.user.id)
    .single();

  if (!member) return res.status(403).json({ error: 'Not a group member' });

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true });

  const enriched = [];
  for (const msg of (messages || [])) {
    const { data: sender } = await supabase
      .from('users')
      .select('id, name, profile_photo')
      .eq('id', msg.sender_id)
      .single();
    enriched.push({ ...msg, sender });
  }

  res.json({ messages: enriched });
});

// Send message (REST fallback)
router.post('/send', authMiddleware, async (req, res) => {
  const { receiver_id, group_id, content, message_type = 'text' } = req.body;
  if (!content) return res.status(400).json({ error: 'Message content required' });

  const msg = {
    sender_id: req.user.id,
    content,
    message_type,
    is_read: false
  };
  if (receiver_id) msg.receiver_id = receiver_id;
  if (group_id) msg.group_id = group_id;

  const { data: message, error } = await supabase
    .from('messages')
    .insert(msg)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: 'Failed to send message' });
  res.json({ message });
});

module.exports = router;
