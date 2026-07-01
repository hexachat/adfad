const express = require('express');
const supabase = require('../config/supabase');
const auth = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const { data: contactIds } = await supabase
      .from('contacts')
      .select('contact_user_id')
      .eq('user_id', req.user.id);

    const ids = (contactIds || []).map(c => c.contact_user_id);
    ids.push(req.user.id);

    const { data: statuses } = await supabase
      .from('statuses')
      .select(`
        id, content, media_url, media_type, background_color,
        created_at, expires_at, user_id,
        user:users(id, name, profile_photo),
        views:status_views(count),
        reactions:status_reactions(id, reaction, user_id,
          user:users(id, name))
      `)
      .in('user_id', ids)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    const grouped = {};
    for (const s of statuses || []) {
      if (!grouped[s.user_id]) {
        grouped[s.user_id] = {
          user: s.user,
          statuses: [],
          hasUnviewed: false
        };
      }
      grouped[s.user_id].statuses.push(s);
    }

    // Check unviewed
    for (const uid of Object.keys(grouped)) {
      const statusIds = grouped[uid].statuses.map(s => s.id);
      const { data: views } = await supabase
        .from('status_views')
        .select('status_id')
        .eq('viewer_id', req.user.id)
        .in('status_id', statusIds);

      const viewedIds = new Set((views || []).map(v => v.status_id));
      grouped[uid].hasUnviewed = statusIds.some(id => !viewedIds.has(id));
    }

    res.json(Object.values(grouped));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/create', auth, async (req, res) => {
  try {
    const { content, media_url, media_type = 'text', background_color = '#0066FF' } = req.body;
    const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { data: status, error } = await supabase
      .from('statuses')
      .insert({
        user_id: req.user.id,
        content,
        media_url,
        media_type,
        background_color,
        expires_at
      })
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:statusId/view', auth, async (req, res) => {
  try {
    await supabase.from('status_views').upsert({
      status_id: req.params.statusId,
      viewer_id: req.user.id
    }, { onConflict: 'status_id,viewer_id' });

    res.json({ message: 'Viewed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:statusId/viewers', auth, async (req, res) => {
  try {
    const { data: viewers } = await supabase
      .from('status_views')
      .select(`
        viewed_at,
        viewer:users(id, name, profile_photo)
      `)
      .eq('status_id', req.params.statusId)
      .order('viewed_at', { ascending: false });

    res.json(viewers || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:statusId/react', auth, async (req, res) => {
  try {
    const { reaction } = req.body;

    await supabase.from('status_reactions').upsert({
      status_id: req.params.statusId,
      user_id: req.user.id,
      reaction
    }, { onConflict: 'status_id,user_id' });

    res.json({ message: 'Reaction added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:statusId', auth, async (req, res) => {
  try {
    await supabase
      .from('statuses')
      .delete()
      .eq('id', req.params.statusId)
      .eq('user_id', req.user.id);

    res.json({ message: 'Status deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
