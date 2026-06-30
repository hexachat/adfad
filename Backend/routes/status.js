const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const supabase = require('../config/supabase');
const { formatUser, USER_PUBLIC_SELECT } = require('../config/user-fields');
const {
  addReaction,
  getReactions,
  getReactionsForStatuses
} = require('../store/status-reactions-store');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const ALLOWED_REACTIONS = ['❤️', '😂', '😮', '😢', '👏', '🔥'];

const uploadDir = path.join(__dirname, '..', 'uploads', 'status');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => cb(null, `status_${Date.now()}${path.extname(file.originalname)}`)
});

const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image too large (max 15MB)' : err.message });
  }
  next(err);
});

async function attachStatusMeta(statuses) {
  if (!statuses?.length) return [];

  const userIds = [...new Set(statuses.map((s) => s.user_id))];
  let userMap = {};
  if (userIds.length) {
    const { data: users } = await supabase
      .from('users')
      .select(USER_PUBLIC_SELECT)
      .in('id', userIds);
    userMap = Object.fromEntries((users || []).map((u) => [u.id, formatUser(u)]));
  }

  const statusIds = statuses.map((s) => s.id);
  let viewsMap = {};
  if (statusIds.length) {
    const { data: views } = await supabase
      .from('status_views')
      .select('status_id, viewer_id, viewed_at')
      .in('status_id', statusIds);
    for (const v of views || []) {
      if (!viewsMap[v.status_id]) viewsMap[v.status_id] = [];
      viewsMap[v.status_id].push({ viewer_id: v.viewer_id, viewed_at: v.viewed_at });
    }
  }

  const reactionsMap = getReactionsForStatuses(statusIds);
  const reactorIds = [...new Set(
    Object.values(reactionsMap).flat().map((r) => r.user_id)
  )];
  let reactorMap = {};
  if (reactorIds.length) {
    const { data: users } = await supabase
      .from('users')
      .select(USER_PUBLIC_SELECT)
      .in('id', reactorIds);
    reactorMap = Object.fromEntries((users || []).map((u) => [u.id, formatUser(u)]));
  }

  return statuses.map((s) => ({
    ...s,
    user: userMap[s.user_id] || { id: s.user_id, name: 'User', phone_number: '', profile_photo: null },
    views: viewsMap[s.id] || [],
    reactions: (reactionsMap[s.id] || []).map((r) => ({
      ...r,
      user: reactorMap[r.user_id] || null
    }))
  }));
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { data: myContacts, error: contactErr } = await supabase
      .from('contacts')
      .select('contact_id')
      .eq('user_id', req.user.id);

    if (contactErr) console.error('Status contacts error:', contactErr);

    const contactIds = (myContacts || []).map((c) => c.contact_id);
    contactIds.push(req.user.id);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: statuses, error } = await supabase
      .from('statuses')
      .select('*')
      .in('user_id', contactIds)
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Load statuses error:', error);
      return res.status(500).json({ error: 'Failed to load statuses' });
    }

    res.json({ statuses: await attachStatusMeta(statuses || []) });
  } catch (err) {
    console.error('Status list error:', err);
    res.status(500).json({ error: 'Failed to load statuses' });
  }
});

router.post('/', authMiddleware, upload.single('media'), async (req, res) => {
  try {
    const text = (req.body.text || '').trim();
    let media_url = null;
    if (req.file) media_url = `/uploads/status/${req.file.filename}`;

    if (!text && !media_url) {
      return res.status(400).json({ error: 'Status text or media required' });
    }

    const { data: status, error } = await supabase
      .from('statuses')
      .insert({ user_id: req.user.id, text: text || '', media_url })
      .select('*')
      .single();

    if (error) {
      console.error('Post status error:', error);
      return res.status(500).json({ error: 'Failed to post status' });
    }

    const [formatted] = await attachStatusMeta([status]);
    res.json({ success: true, status: formatted });
  } catch (err) {
    res.status(500).json({ error: 'Failed to post status' });
  }
});

router.post('/:id/view', authMiddleware, async (req, res) => {
  try {
    await supabase.from('status_views').upsert(
      { status_id: req.params.id, viewer_id: req.user.id, viewed_at: new Date().toISOString() },
      { onConflict: 'status_id,viewer_id' }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark viewed' });
  }
});

router.post('/:id/react', authMiddleware, async (req, res) => {
  try {
    const reaction = (req.body.reaction || '').trim();
    if (!ALLOWED_REACTIONS.includes(reaction)) {
      return res.status(400).json({ error: 'Invalid reaction' });
    }

    const entry = addReaction(req.params.id, req.user.id, reaction);
    const { data: userRow } = await supabase
      .from('users')
      .select(USER_PUBLIC_SELECT)
      .eq('id', req.user.id)
      .single();

    res.json({
      success: true,
      reaction: { ...entry, user: formatUser(userRow) }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to react' });
  }
});

router.get('/:id/reactions', authMiddleware, async (req, res) => {
  try {
    const reactions = getReactions(req.params.id);
    const userIds = [...new Set(reactions.map((r) => r.user_id))];
    let userMap = {};
    if (userIds.length) {
      const { data: users } = await supabase
        .from('users')
        .select(USER_PUBLIC_SELECT)
        .in('id', userIds);
      userMap = Object.fromEntries((users || []).map((u) => [u.id, formatUser(u)]));
    }
    res.json({
      reactions: reactions.map((r) => ({ ...r, user: userMap[r.user_id] || null }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load reactions' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await supabase.from('statuses').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete status' });
  }
});

router.get('/:id/views', authMiddleware, async (req, res) => {
  try {
    const { data: status } = await supabase
      .from('statuses')
      .select('user_id')
      .eq('id', req.params.id)
      .single();

    if (!status || status.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your status' });
    }

    const { data: views } = await supabase
      .from('status_views')
      .select('viewer_id, viewed_at')
      .eq('status_id', req.params.id);

    const reactions = getReactions(req.params.id);
    const reactionMap = Object.fromEntries(reactions.map((r) => [r.user_id, r.reaction]));

    const allIds = [...new Set([
      ...(views || []).map((v) => v.viewer_id),
      ...reactions.map((r) => r.user_id)
    ])];

    let userMap = {};
    if (allIds.length) {
      const { data: users } = await supabase
        .from('users')
        .select(USER_PUBLIC_SELECT)
        .in('id', allIds);
      userMap = Object.fromEntries((users || []).map((u) => [u.id, formatUser(u)]));
    }

    res.json({
      views: (views || []).map((v) => ({
        ...v,
        viewer: userMap[v.viewer_id] || null,
        reaction: reactionMap[v.viewer_id] || null
      })),
      reactions: reactions.map((r) => ({
        ...r,
        user: userMap[r.user_id] || null
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch views' });
  }
});

module.exports = router;
