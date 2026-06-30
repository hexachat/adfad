const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = require('express').Router();

// Get call history
router.get('/', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  const { data: calls } = await supabase
    .from('calls')
    .select(`
      *,
      caller:users!calls_caller_id_fkey (id, name, phone_number, profile_photo),
      receiver:users!calls_receiver_id_fkey (id, name, phone_number, profile_photo)
    `)
    .or(`caller_id.eq.${userId},receiver_id.eq.${userId}`)
    .order('started_at', { ascending: false })
    .limit(50);

  const formatted = (calls || []).map(call => {
    const isOutgoing = call.caller_id === userId;
    const other = isOutgoing ? call.receiver : call.caller;
    return {
      id: call.id,
      call_type: call.call_type,
      status: call.status,
      started_at: call.started_at,
      ended_at: call.ended_at,
      duration: call.duration,
      direction: isOutgoing ? 'outgoing' : 'incoming',
      contact: other
    };
  });

  res.json({ calls: formatted });
});

// Log call
router.post('/log', authMiddleware, async (req, res) => {
  const { receiver_id, call_type, status, duration = 0 } = req.body;

  const { data: call } = await supabase
    .from('calls')
    .insert({
      caller_id: req.user.id,
      receiver_id,
      call_type: call_type || 'audio',
      status: status || 'ended',
      duration,
      ended_at: new Date().toISOString()
    })
    .select('*')
    .single();

  res.json({ call });
});

// Update call status
router.put('/:callId', authMiddleware, async (req, res) => {
  const { status, duration } = req.body;
  const updates = { status };
  if (duration !== undefined) updates.duration = duration;
  if (status === 'ended' || status === 'missed' || status === 'declined') {
    updates.ended_at = new Date().toISOString();
  }

  await supabase.from('calls').update(updates).eq('id', req.params.callId);
  res.json({ message: 'Call updated' });
});

module.exports = router;
