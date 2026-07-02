const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Get call history
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { data: calls } = await supabase.from('calls')
      .select(`
        *,
        caller:users!caller_id(id, name, phone, avatar_url),
        receiver:users!receiver_id(id, name, phone, avatar_url)
      `)
      .or(`caller_id.eq.${req.user.id},receiver_id.eq.${req.user.id}`)
      .order('started_at', { ascending: false })
      .limit(50);

    res.json({ calls: calls || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Log call
router.post('/log', authMiddleware, async (req, res) => {
  try {
    const { receiver_id, call_type, status, duration } = req.body;
    const { data: call } = await supabase.from('calls').insert({
      caller_id: req.user.id,
      receiver_id,
      call_type,
      status,
      duration: duration || 0,
      ended_at: status === 'ended' ? new Date().toISOString() : null,
      answered_at: status === 'answered' ? new Date().toISOString() : null
    }).select('*').single();

    res.json({ call });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update call status
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { status, duration } = req.body;
    const updates = { status };
    if (status === 'answered') updates.answered_at = new Date().toISOString();
    if (status === 'ended' || status === 'missed' || status === 'rejected') {
      updates.ended_at = new Date().toISOString();
      if (duration) updates.duration = duration;
    }

    const { data: call } = await supabase.from('calls')
      .update(updates).eq('id', req.params.id).select('*').single();

    res.json({ call });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
