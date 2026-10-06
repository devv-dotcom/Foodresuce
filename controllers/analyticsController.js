const Analytics = require('../models/Analytics');
const ActivityLog = require('../models/ActivityLog');

exports.getAnalytics = async (req, res, next) => {
  try {
    const analytics = await Analytics.overview();
    if (req.user) {
      await ActivityLog.create({ actorUserId: req.user.id, action: 'analytics_viewed', entityType: 'analytics', ipAddress: req.ip });
    }
    return res.json({ success: true, analytics });
  } catch (error) { next(error); }
};

exports.getPublicAnalytics = async (_req, res, next) => {
  try {
    const summary = await Analytics.publicSummary();
    return res.json({ success: true, summary });
  } catch (error) { next(error); }
};

exports.getMapData = async (req, res, next) => {
  try {
    const data = await Analytics.mapData();
    return res.json({ success: true, mapData: data });
  } catch (error) { next(error); }
};
