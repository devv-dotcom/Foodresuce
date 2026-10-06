const pool = require('../config/database');
const Report = require('../models/Report');
const ActivityLog = require('../models/ActivityLog');

const rangeFor = type => {
  const now = new Date();
  if (type === 'daily') return { from: now.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
  if (type === 'weekly') return { from: 'DATE_SUB(CURDATE(), INTERVAL 6 DAY)', to: 'CURDATE()', sql: true };
  if (type === 'monthly') return { from: 'DATE_SUB(CURDATE(), INTERVAL 1 MONTH)', to: 'CURDATE()', sql: true };
  if (type === 'yearly') return { from: 'DATE_SUB(CURDATE(), INTERVAL 1 YEAR)', to: 'CURDATE()', sql: true };
  return null;
};

exports.getReports = async (req, res, next) => {
  try {
    if (!req.query.type) return res.json({ success: true, reports: await Report.list(Math.min(Number(req.query.limit) || 20, 100), Math.max(Number(req.query.offset) || 0, 0)) });
    const range = rangeFor(req.query.type);
    if (!range) return res.status(422).json({ success: false, message: 'Report type must be daily, weekly, monthly, yearly, business, NGO, or donation.' });
    const condition = range.sql ? `d.created_at >= ${range.from} AND d.created_at < DATE_ADD(${range.to}, INTERVAL 1 DAY)` : 'DATE(d.created_at) BETWEEN ? AND ?';
    const values = range.sql ? [] : [range.from, range.to];
    const [[summary], [byStatus], [byBusiness]] = await Promise.all([
      pool.execute(`SELECT COUNT(*) AS total_donations, COALESCE(SUM(d.number_of_meals), 0) AS total_meals, SUM(d.status = 'completed') AS completed_donations, SUM(d.status = 'cancelled') AS cancelled_donations FROM donations d WHERE d.deleted_at IS NULL AND ${condition}`, values),
      pool.execute(`SELECT d.status, COUNT(*) AS count FROM donations d WHERE d.deleted_at IS NULL AND ${condition} GROUP BY d.status`, values),
      pool.execute(`SELECT COALESCE(u.business_name, u.full_name) AS business_name, COUNT(*) AS donations, COALESCE(SUM(d.number_of_meals), 0) AS meals FROM donations d JOIN users u ON u.id = d.business_user_id WHERE d.deleted_at IS NULL AND ${condition} GROUP BY d.business_user_id ORDER BY donations DESC LIMIT 10`, values)
    ]);
    const report = { type: req.query.type, range: range.sql ? req.query.type : range, summary: summary[0], byStatus: byStatus[0], topBusinesses: byBusiness[0] };
    const reportId = await Report.create(req.admin.admin_id, req.query.type, new Date().toISOString().slice(0, 10), req.query, report);
    await ActivityLog.create({ actorUserId: req.user.id, action: 'report_generated', entityType: 'report', entityId: reportId, details: { type: req.query.type }, ipAddress: req.ip });
    return res.json({ success: true, report: { id: reportId, ...report } });
  } catch (error) { next(error); }
};
