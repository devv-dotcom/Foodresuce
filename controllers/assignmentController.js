const pool = require('../config/database');
const notifStore = require('../services/notifications');
const isLegacySchemaError = error => error?.code === 'ER_NO_SUCH_TABLE' || error?.code === 'ER_BAD_FIELD_ERROR';

// Assignments are owned by the NGO user that accepted the donation. Admins
// may view them for support; every other role must match the assigned user.
exports.authorizeAssignment = async (req, res, next) => {
  try {
    const id = req.params.id;
    let rows;
    try {
      [rows] = await pool.execute(
        `SELECT a.id, a.donation_id, a.member_id
         FROM assignments a
         WHERE a.id = ? AND (a.member_id = ? OR ? = 'admin')
         LIMIT 1`,
        [id, req.user.id, req.user.role]
      );
    } catch (error) {
      if (!isLegacySchemaError(error)) throw error;
      // Older installations may not have the assignments table. In that
      // schema an NGO can access only pickup requests belonging to its NGO.
      [rows] = await pool.execute(
        `SELECT p.id, p.donation_id, p.volunteer_id AS member_id
         FROM pickup_requests p
         LEFT JOIN ngos n ON n.id = p.ngo_id
         WHERE p.id = ? AND (? = 'admin' OR n.user_id = ?)
         LIMIT 1`,
        [id, req.user.role, req.user.id]
      );
    }
    if (!rows.length) return res.status(404).json({ success: false, message: 'Assignment not found.' });
    req.assignmentAccess = rows[0];
    return next();
  } catch (error) { return next(error); }
};

/**
 * Helper to normalize assignment object format for API responses
 */
const formatAssignment = (row, proofs = []) => ({
  id: row.id,
  donationId: row.donation_id,
  memberId: row.member_id,
  assignedBy: row.assigned_by,
  donorName: row.donor_name || row.business_name || 'Food Donor',
  donorAddress: row.pickup_address || row.donor_address || '',
  destinationAddress: row.delivery_address || row.destination_address || 'NGO Distribution Point',
  foodName: row.food_name || 'Surplus Food',
  foodType: row.food_type || 'cooked_meals',
  quantity: row.quantity || '1 batch',
  numberOfMeals: row.number_of_meals || 25,
  pickupTime: row.pickup_time,
  deliveryTime: row.delivery_time,
  status: row.status,
  pickupConfirmedAt: row.pickup_confirmed_at,
  deliveryConfirmedAt: row.delivery_confirmed_at,
  proofs: proofs,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

// GET /api/assignments
exports.getAssignments = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const tab = (req.query.tab || req.query.status || 'all').toLowerCase();
    
    let statusFilter = '';
    const values = [userId];

    if (tab === 'active') {
      statusFilter = `AND a.status IN ('ACCEPTED', 'ASSIGNED', 'GOING_TO_PICKUP', 'FOOD_COLLECTED', 'OUT_FOR_DELIVERY', 'accepted', 'volunteer_assigned', 'pickup_started', 'food_collected', 'on_the_way')`;
    } else if (tab === 'upcoming') {
      statusFilter = `AND a.status IN ('ACCEPTED', 'ASSIGNED', 'accepted', 'pending')`;
    } else if (tab === 'completed') {
      statusFilter = `AND a.status IN ('DELIVERED', 'COMPLETED', 'delivered', 'completed')`;
    } else if (tab === 'cancelled') {
      statusFilter = `AND a.status IN ('CANCELLED', 'cancelled')`;
    }

    // Try reading from assignments table
    let rows = [];
    try {
      const [results] = await pool.execute(
        `SELECT a.*, d.food_name, d.food_type, d.quantity, d.number_of_meals, d.pickup_address,
                u.business_name, u.full_name AS donor_name
         FROM assignments a
         JOIN donations d ON a.donation_id = d.id
         JOIN users u ON d.business_user_id = u.id
         WHERE a.member_id = ? ${statusFilter}
         ORDER BY a.updated_at DESC`,
        values
      );
      rows = results;
    } catch (err) {
      // Fallback query to pickup_requests if assignments table isn't migrated yet
      const [pickupResults] = await pool.execute(
        `SELECT p.id, p.donation_id, p.volunteer_id AS member_id, p.ngo_id AS assigned_by,
                p.status, p.created_at, p.updated_at, d.food_name, d.food_type, d.quantity,
                d.number_of_meals, p.pickup_address, p.delivery_address AS destination_address,
                u.business_name, u.full_name AS donor_name
         FROM pickup_requests p
         JOIN donations d ON p.donation_id = d.id
         JOIN users u ON p.business_id = u.id
          LEFT JOIN ngos n ON n.id = p.ngo_id
          WHERE (? = 'admin' OR n.user_id = ?)
         ORDER BY p.updated_at DESC`,
        [req.user.role, userId]
      );
      rows = pickupResults;
    }

    const assignments = rows.map(r => formatAssignment(r));
    return res.json({ success: true, assignments, count: assignments.length });
  } catch (error) { next(error); }
};

// GET /api/assignments/:id
exports.getAssignmentById = async (req, res, next) => {
  try {
    const id = req.params.id;
    const userId = req.user.id;

    let assignmentRow = null;
    try {
      const [rows] = await pool.execute(
        `SELECT a.*, d.food_name, d.food_type, d.quantity, d.number_of_meals, d.pickup_address,
                d.description, d.expiry_time, u.business_name, u.full_name AS donor_name, u.mobile AS donor_phone
         FROM assignments a
         JOIN donations d ON a.donation_id = d.id
         JOIN users u ON d.business_user_id = u.id
         WHERE a.id = ? AND (a.member_id = ? OR ? = 'admin') LIMIT 1`,
        [id, userId, req.user.role]
      );
      assignmentRow = rows[0];
    } catch (err) {
      const [rows] = await pool.execute(
        `SELECT p.id, p.donation_id, p.volunteer_id AS member_id, p.status, p.pickup_address,
                p.delivery_address AS destination_address, d.food_name, d.food_type, d.quantity,
                d.description, d.expiry_time, u.business_name, u.full_name AS donor_name, u.mobile AS donor_phone
         FROM pickup_requests p
         JOIN donations d ON p.donation_id = d.id
         JOIN users u ON p.business_id = u.id
         LEFT JOIN ngos n ON n.id = p.ngo_id
         WHERE p.id = ? AND (? = 'admin' OR n.user_id = ?) LIMIT 1`,
        [id, req.user.role, userId]
      );
      assignmentRow = rows[0];
    }

    if (!assignmentRow) {
      return res.status(404).json({ success: false, message: 'Assignment not found.' });
    }

    // Fetch proofs for this assignment
    let proofRows = [];
    try {
      const [proofs] = await pool.execute(
        `SELECT * FROM proofs WHERE assignment_id = ? ORDER BY created_at ASC`,
        [id]
      );
      proofRows = proofs;
    } catch (_) {}

    return res.json({
      success: true,
      assignment: formatAssignment(assignmentRow, proofRows)
    });
  } catch (error) { next(error); }
};

// POST /api/assignments/:id/start
exports.startPickup = async (req, res, next) => {
  try {
    const id = req.params.id;
    const userId = req.user.id;

    await pool.execute(
      `UPDATE assignments SET status = 'GOING_TO_PICKUP', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (member_id = ? OR ? = 'admin')`,
      [id, userId, req.user.role]
    );

    // Also update fallback pickup_requests
    try {
      await pool.execute(
        `UPDATE pickup_requests SET status = 'pickup_started' WHERE id = ? AND (? = 'admin' OR ngo_id = (SELECT id FROM ngos WHERE user_id = ? LIMIT 1))`,
        [id, req.user.role, userId]
      );
    } catch (_) {}

    notifStore.push({
      recipientUserId: userId,
      type: 'ASSIGNMENT_STATUS',
      title: '🚗 En Route to Pickup Location',
      body: `You started the pickup process for Assignment #${id}. Navigate safely!`
    });

    return res.json({ success: true, message: 'Pickup started. En route to donor location.', status: 'GOING_TO_PICKUP' });
  } catch (error) { next(error); }
};

// POST /api/assignments/:id/pickup
exports.confirmPickup = async (req, res, next) => {
  try {
    const id = req.params.id;
    const userId = req.user.id;

    await pool.execute(
      `UPDATE assignments SET status = 'FOOD_COLLECTED', pickup_confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (member_id = ? OR ? = 'admin')`,
      [id, userId, req.user.role]
    );

    try {
      await pool.execute(
        `UPDATE pickup_requests SET status = 'food_collected' WHERE id = ? AND (? = 'admin' OR ngo_id = (SELECT id FROM ngos WHERE user_id = ? LIMIT 1))`,
        [id, req.user.role, userId]
      );
    } catch (_) {}

    notifStore.push({
      recipientUserId: userId,
      type: 'PICKUP_COMPLETED',
      title: '📦 Food Collected Successfully',
      body: `Food collection confirmed for Assignment #${id}. Proceed to delivery point.`
    });

    return res.json({ success: true, message: 'Food collection confirmed.', status: 'FOOD_COLLECTED' });
  } catch (error) { next(error); }
};

// POST /api/assignments/:id/delivery
exports.startDelivery = async (req, res, next) => {
  try {
    const id = req.params.id;
    const userId = req.user.id;

    await pool.execute(
      `UPDATE assignments SET status = 'OUT_FOR_DELIVERY', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (member_id = ? OR ? = 'admin')`,
      [id, userId, req.user.role]
    );

    try {
      await pool.execute(
        `UPDATE pickup_requests SET status = 'on_the_way' WHERE id = ? AND (? = 'admin' OR ngo_id = (SELECT id FROM ngos WHERE user_id = ? LIMIT 1))`,
        [id, req.user.role, userId]
      );
    } catch (_) {}

    notifStore.push({
      recipientUserId: userId,
      type: 'ASSIGNMENT_STATUS',
      title: '🚚 Out for Delivery',
      body: `You are on the way to the delivery location for Assignment #${id}.`
    });

    return res.json({ success: true, message: 'Delivery started. En route to recipient.', status: 'OUT_FOR_DELIVERY' });
  } catch (error) { next(error); }
};

// POST /api/assignments/:id/complete
exports.completeAssignment = async (req, res, next) => {
  try {
    const id = req.params.id;
    const userId = req.user.id;

    const [rows] = await pool.execute(
      `SELECT donation_id FROM assignments WHERE id = ? AND (member_id = ? OR ? = 'admin') LIMIT 1`,
      [id, userId, req.user.role]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Assignment not found.' });
    const donationId = rows[0]?.donation_id;

    const [updated] = await pool.execute(
      `UPDATE assignments SET status = 'COMPLETED', delivery_confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (member_id = ? OR ? = 'admin')`,
      [id, userId, req.user.role]
    );
    if (!updated.affectedRows) return res.status(404).json({ success: false, message: 'Assignment not found.' });

    if (donationId) {
      await pool.execute(
        `UPDATE donations SET status = 'delivered', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [donationId]
      );
    }

    try {
      await pool.execute(
        `UPDATE pickup_requests SET status = 'completed' WHERE id = ? AND (? = 'admin' OR ngo_id = (SELECT id FROM ngos WHERE user_id = ? LIMIT 1))`,
        [id, req.user.role, userId]
      );
    } catch (_) {}

    // Record impact log
    try {
      await pool.execute(
        `INSERT INTO impact_logs (user_id, donation_id, assignment_id, food_quantity, action)
         VALUES (?, ?, ?, 25, 'COMPLETED_DELIVERY')`,
        [userId, donationId || null, id]
      );
    } catch (_) {}

    notifStore.push({
      recipientUserId: userId,
      type: 'DELIVERY_COMPLETED',
      title: '🎉 Food Rescue Mission Completed!',
      body: `Thank you! Assignment #${id} has been delivered successfully. Impact stats updated.`
    });

    return res.json({ success: true, message: 'Assignment completed successfully! Great job.', status: 'COMPLETED' });
  } catch (error) { next(error); }
};

// POST /api/assignments/:id/cancel
exports.cancelAssignment = async (req, res, next) => {
  try {
    const id = req.params.id;
    const userId = req.user.id;

    const [rows] = await pool.execute(
      `SELECT donation_id FROM assignments WHERE id = ? AND (member_id = ? OR ? = 'admin') LIMIT 1`,
      [id, userId, req.user.role]
    );
    
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Assignment not found or unauthorized.' });
    }

    const donationId = rows[0].donation_id;

    const [updated] = await pool.execute(
      `UPDATE assignments SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (member_id = ? OR ? = 'admin')`,
      [id, userId, req.user.role]
    );
    if (!updated.affectedRows) return res.status(404).json({ success: false, message: 'Assignment not found.' });

    if (donationId) {
      await pool.execute(
        `UPDATE donations SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [donationId]
      );
    }

    return res.json({ success: true, message: 'Assignment cancelled. Food donation has been returned to available listings.' });
  } catch (error) { next(error); }
};

// POST /api/assignments/:id/proof
exports.uploadProof = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(422).json({ success: false, message: 'Proof photo is required.' });
    }

    const assignmentId = req.params.id;
    const uploadedBy = req.user.id;
    const proofType = (req.body.type || 'DELIVERY').toUpperCase();
    const notes = req.body.notes || '';
    const imageUrl = `/uploads/delivery-proof/${req.file.filename}`;

    try {
      await pool.execute(
        `INSERT INTO proofs (assignment_id, uploaded_by, type, image_url, notes)
         VALUES (?, ?, ?, ?, ?)`,
        [assignmentId, uploadedBy, proofType, imageUrl, notes]
      );
    } catch (err) {
      // Fallback into delivery_proofs table
      await pool.execute(
        `INSERT INTO delivery_proofs (pickup_id, image_path, notes)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE image_path = VALUES(image_path), notes = VALUES(notes)`,
        [assignmentId, imageUrl, notes]
      );
    }

    return res.status(201).json({
      success: true,
      message: `${proofType} proof photo uploaded successfully.`,
      proof: {
        assignmentId,
        uploadedBy,
        type: proofType,
        imageUrl,
        notes,
        createdAt: new Date()
      }
    });
  } catch (error) { next(error); }
};

// GET /api/assignments/:id/proof
exports.getProofs = async (req, res, next) => {
  try {
    const assignmentId = req.params.id;
    let proofs = [];
    try {
      const [rows] = await pool.execute(
        `SELECT * FROM proofs WHERE assignment_id = ? ORDER BY created_at ASC`,
        [assignmentId]
      );
      proofs = rows;
    } catch (_) {
      const [rows] = await pool.execute(
        `SELECT id, pickup_id AS assignment_id, image_path AS image_url, notes, uploaded_at AS created_at
         FROM delivery_proofs WHERE pickup_id = ?`,
        [assignmentId]
      );
      proofs = rows;
    }
    return res.json({ success: true, proofs });
  } catch (error) { next(error); }
};
