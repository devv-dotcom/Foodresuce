const pool = require('../config/database');
const DonationChat = require('../models/DonationChat');
const { sendNotification } = require('../utils/notify');

const resolveChat = async (req, res) => {
  const participant = await DonationChat.participant(req.params.donationId, req.user.id);
  if (!participant) {
    res.status(403).json({ success: false, message: 'Only the donor and accepting NGO may access this donation conversation.' });
    return null;
  }
  const connection = await pool.getConnection();
  try {
    const conversation = await DonationChat.getOrCreate(connection, participant);
    return { participant, conversation };
  } finally { connection.release(); }
};

exports.getConversation = async (req, res, next) => {
  try {
    const chat = await resolveChat(req, res);
    if (!chat) return;
    const messages = await DonationChat.messages(chat.conversation.id, req.user.id);
    const unreadCount = await DonationChat.unreadCount(chat.conversation.id, req.user.id);
    return res.json({ success: true, conversation: { id: chat.conversation.id, donationId: chat.participant.donation_id, foodName: chat.participant.food_name, donorName: chat.participant.donor_name, ngoName: chat.participant.ngo_name }, messages, unreadCount });
  } catch (error) { next(error); }
};

exports.sendMessage = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const participant = await DonationChat.participant(req.params.donationId, req.user.id, connection);
    if (!participant) return res.status(403).json({ success: false, message: 'Only the donor and accepting NGO may send messages for this donation.' });
    const recipientUserId = Number(participant.donor_user_id) === Number(req.user.id) ? participant.ngo_user_id : participant.donor_user_id;
    await connection.beginTransaction();
    const conversation = await DonationChat.getOrCreate(connection, participant);
    const messageId = await DonationChat.send(connection, conversation.id, req.user.id, recipientUserId, req.body.message.trim());
    await sendNotification({ recipientUserId, title: 'New donation message', message: `You have a new message about ${participant.food_name}.`, connection });
    await connection.commit();
    return res.status(201).json({ success: true, message: { id: messageId, sender_user_id: req.user.id, recipient_user_id: recipientUserId, body: req.body.message.trim(), created_at: new Date(), read_at: null } });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};
