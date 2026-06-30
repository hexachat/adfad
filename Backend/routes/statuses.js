const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const reactionStore = require('../utils/reactionStore');
const { REACTION_KEYS, REACTION_EMOJI } = require('../utils/reactions');

const router = require('express').Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname) || '.webm'}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/', authMiddleware, upload.single('media'), async (req, res) => {
  try {
    const { content, media_type = 'text', background_color = '#000000' } = req.body;
    const status = {
      user_id: req.user.id,
      content: content || '',
      media_type,
      background_color,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };
    if (req.file) {
      status.media_url = `/uploads/${req.file.filename}`;
      if (req.file.mimetype.startsWith('video')) status.media_type = 'video';
      else if (req.file.mimetype.startsWith('audio')) status.media_type = 'audio';
      else status.media_type = 'image';
    }
    const { data, error } = await supabase.from('statuses').insert(status).select('*').single();
    if (error) return res.status(500).json({ error: 'Failed to add status' });
    res.json({ status: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add status' });
  }
});

async function getReactionsFromDb(statusIds) {
  const { data, error } = await supabase
    .from('status_reactions')
    .select('status_id, reaction, user_id')
    .in('status_id', statusIds);
  return { data: data || [], error };
}

async function attachReactions(statuses, userId) {
  if (!statuses?.length) return statuses;
  const ids = statuses.map(s => s.id);
  let reactions = [];
  const { data, error } = await getReactionsFromDb(ids);

  if (!error) {
    reactions = data;
  } else {
    reactions = ids.flatMap(id =>
      reactionStore.getForStatus(id).map(r => ({ ...r, status_id: id }))
    );
  }

  return statuses.map(s => {
    const list = reactions.filter(r => r.status_id === s.id);
    const grouped = {};
    list.forEach(r => {
      const emoji = REACTION_EMOJI[r.reaction] || r.reaction;
      if (!grouped[emoji]) grouped[emoji] = 0;
      grouped[emoji]++;
    });
    const mine = list.find(r => r.user_id === userId);
    return {
      ...s,
      reactions: grouped,
      my_reaction: mine ? (REACTION_EMOJI[mine.reaction] || mine.reaction) : null,
      my_reaction_key: mine?.reaction || null,
      reaction_count: list.length
    };
  });
}

router.get('/feed', authMiddleware, async (req, res) => {
  try {
    const { data: contacts } = await supabase
      .from('contacts').select('contact_user_id').eq('user_id', req.user.id);

    const contactIds = (contacts || []).map(c => c.contact_user_id);
    contactIds.push(req.user.id);

    const { data: statuses } = await supabase
      .from('statuses')
      .select('*, user:users (id, name, profile_photo, phone_number)')
      .in('user_id', contactIds)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true });

    const enriched = await attachReactions(statuses || [], req.user.id);
    const grouped = {};

    for (const s of enriched) {
      if (!grouped[s.user_id]) {
        grouped[s.user_id] = { user: s.user, statuses: [], has_unseen: false };
      }
      grouped[s.user_id].statuses.push(s);
    }

    const viewerId = req.user.id;
    await Promise.all(Object.keys(grouped).map(async (uid) => {
      const statusIds = grouped[uid].statuses.map(s => s.id);
      const { data: views } = await supabase
        .from('status_views')
        .select('status_id')
        .eq('viewer_id', viewerId)
        .in('status_id', statusIds);

      const viewedIds = new Set((views || []).map(v => v.status_id));
      grouped[uid].has_unseen = uid !== viewerId && statusIds.some(id => !viewedIds.has(id));
    }));

    res.json({ feed: Object.values(grouped) });
  } catch (err) {
    console.error('Status feed error:', err);
    res.status(500).json({ error: 'Failed to load statuses' });
  }
});

router.get('/mine', authMiddleware, async (req, res) => {
  const { data: statuses } = await supabase
    .from('statuses')
    .select('*')
    .eq('user_id', req.user.id)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  res.json({ statuses: statuses || [] });
});

router.post('/:statusId/view', authMiddleware, async (req, res) => {
  try {
    await supabase.from('status_views').upsert({
      status_id: req.params.statusId,
      viewer_id: req.user.id
    }, { onConflict: 'status_id,viewer_id' });
    res.json({ message: 'Viewed' });
  } catch {
    res.json({ message: 'Viewed' });
  }
});

router.post('/:statusId/react', authMiddleware, async (req, res) => {
  try {
    const reaction = (req.body.reaction || '').trim();
    if (!reaction || !REACTION_KEYS.includes(reaction)) {
      return res.status(400).json({ error: 'Invalid reaction' });
    }

    const statusId = req.params.statusId;
    const userId = req.user.id;

    const { data: existing, error: readErr } = await supabase
      .from('status_reactions')
      .select('id, reaction')
      .eq('status_id', statusId)
      .eq('user_id', userId)
      .maybeSingle();

    if (readErr) {
      const list = reactionStore.getForStatus(statusId);
      const mine = list.find(r => r.user_id === userId);
      if (mine?.reaction === reaction) {
        reactionStore.removeReaction(statusId, userId);
        return res.json({ message: 'Reaction removed', reaction: null, emoji: null });
      }
      reactionStore.setReaction(statusId, userId, reaction);
      return res.json({
        message: 'Reaction added',
        reaction,
        emoji: REACTION_EMOJI[reaction]
      });
    }

    if (existing?.reaction === reaction) {
      await supabase.from('status_reactions').delete().eq('id', existing.id);
      return res.json({ message: 'Reaction removed', reaction: null, emoji: null });
    }

    const { error: writeErr } = await supabase.from('status_reactions').upsert({
      status_id: statusId,
      user_id: userId,
      reaction
    }, { onConflict: 'status_id,user_id' });

    if (writeErr) {
      reactionStore.setReaction(statusId, userId, reaction);
    }

    res.json({
      message: 'Reaction added',
      reaction,
      emoji: REACTION_EMOJI[reaction]
    });
  } catch (err) {
    console.error('React error:', err);
    res.status(500).json({ error: 'Failed to save reaction' });
  }
});

router.get('/:statusId/viewers', authMiddleware, async (req, res) => {
  try {
    const { data: views } = await supabase
      .from('status_views')
      .select('viewed_at, viewer:users (id, name, profile_photo, phone_number)')
      .eq('status_id', req.params.statusId)
      .order('viewed_at', { ascending: false });
    res.json({ viewers: views || [] });
  } catch {
    res.json({ viewers: [] });
  }
});

router.delete('/:statusId', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabase.from('statuses')
      .select('id')
      .eq('id', req.params.statusId)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (!data) return res.status(404).json({ error: 'Status not found' });

    await supabase.from('status_reactions').delete().eq('status_id', req.params.statusId);
    reactionStore.deleteForStatus(req.params.statusId);
    await supabase.from('status_views').delete().eq('status_id', req.params.statusId);
    await supabase.from('statuses').delete().eq('id', req.params.statusId);

    res.json({ message: 'Status deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete status' });
  }
});

module.exports = router;
