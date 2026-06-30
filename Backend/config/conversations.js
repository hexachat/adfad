function getDirectConversationId(userIdA, userIdB) {
  return [userIdA, userIdB].sort().join('::');
}

function getOtherUserIdFromConversation(conversationId, myUserId) {
  if (!conversationId) return null;
  const parts = conversationId.split('::');
  return parts.find((id) => id !== myUserId) || null;
}

module.exports = {
  getDirectConversationId,
  getOtherUserIdFromConversation
};
