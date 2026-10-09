const pool = require('../config/database');
const Donation = require('../models/Donation');
const geoService = require('../services/geoService');
const notifStore = require('../services/notifications');
const { createHandoffCode, hashHandoffCode, isValidHandoffCode } = require('../utils/handoffCode');

async function createUniqueHandoffCode(connection, reservedHashes = []) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = createHandoffCode();
    const hash = hashHandoffCode(code);
    if (reservedHashes.includes(hash)) continue;
    const [matches] = await connection.execute(
      'SELECT id FROM assignments WHERE pickup_otp_hash = ? OR delivery_otp_hash = ? LIMIT 1',
      [hash, hash]
    );
    if (!matches.length) return { code, hash };
  }
  throw new Error('Could not generate a unique handoff code. Please retry.');
}

async function ensureHandoffCodes(userId, row) {
  if (['COMPLETED', 'CANCELLED', 'DELIVERED', 'DISTRIBUTED'].includes(String(row.status || '').toUpperCase())) return row;
  if (row.pickup_code && row.delivery_code && row.pickup_otp_hash && row.delivery_otp_hash) return row;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT id, status, pickup_code, delivery_code, pickup_otp_hash, delivery_otp_hash FROM assignments WHERE id = ? AND member_id = ? FOR UPDATE',
      [row.id, userId]
    );
    if (!rows.length) { await connection.rollback(); return row; }
    const current = rows[0];
    if (['COMPLETED', 'CANCELLED', 'DELIVERED', 'DISTRIBUTED'].includes(String(current.status || '').toUpperCase())) {
      await connection.rollback();
      return row;
    }
    let pickup = current.pickup_code ? { code: current.pickup_code, hash: current.pickup_otp_hash } : null;
    let delivery = current.delivery_code ? { code: current.delivery_code, hash: current.delivery_otp_hash } : null;
    if (!pickup || !pickup.hash) pickup = await createUniqueHandoffCode(connection);
    if (!delivery || !delivery.hash) delivery = await createUniqueHandoffCode(connection, [pickup.hash]);
    await connection.execute(
      'UPDATE assignments SET pickup_code = ?, delivery_code = ?, pickup_otp_hash = ?, delivery_otp_hash = ? WHERE id = ?',
      [pickup.code, delivery.code, pickup.hash, delivery.hash, row.id]
    );
    await connection.commit();
    return { ...row, pickup_code: pickup.code, delivery_code: delivery.code };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

const withoutCodeHashes = row => {
  const { pickup_otp_hash, delivery_otp_hash, ...safe } = row;
  return safe;
};

const ownedAssignment = async (connection, assignmentId, userId, lock = false) => {
  const [rows] = await connection.execute(
    `SELECT a.id, a.donation_id, a.status, d.quantity, d.number_of_meals, d.status AS donation_status
     FROM assignments a JOIN donations d ON d.id = a.donation_id
     WHERE a.id = ? AND a.member_id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [assignmentId, userId]
  );
  return rows[0] || null;
};

const transition = async (req, res, next, { from, to, message, extraSql = '', extraValues = [] }) => {
  try {
    const assignment = await ownedAssignment(pool, req.params.id, req.user.id);
    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found.' });
    if (assignment.status === 'COMPLETED') return res.status(409).json({ success: false, message: 'This assignment is already completed.' });
    if (!from.includes(assignment.status)) return res.status(409).json({ success: false, message: `This action is not available while the assignment is ${assignment.status}.` });
    await pool.execute(
      `UPDATE assignments SET status = ?, ${extraSql} updated_at = CURRENT_TIMESTAMP WHERE id = ? AND member_id = ?`,
      [to, ...extraValues, req.params.id, req.user.id]
    );
    return res.json({ success: true, message, status: to });
  } catch (error) { next(error); }
};

/**
 * Smart Food Matching Algorithm
 * Computes a 0-100% match score for a donation based on distance, expiry urgency,
 * partner transport capacity, trust score, and availability.
 */
const calculateSmartMatch = (donation, partnerLat, partnerLng, trustScore = 95) => {
  let score = 70; // baseline

  // 1. Distance score (max +20 points for close distance)
  let distKm = 2.0;
  if (donation.latitude && donation.longitude && !Number.isNaN(partnerLat) && !Number.isNaN(partnerLng)) {
    distKm = geoService.calculateHaversineDistance(partnerLat, partnerLng, Number(donation.latitude), Number(donation.longitude));
  }
  distKm = Math.round(distKm * 10) / 10;

  if (distKm <= 2) score += 20;
  else if (distKm <= 5) score += 14;
  else if (distKm <= 10) score += 8;
  else score += 2;

  // 2. Expiry urgency boost (max +10 points if expiring soon)
  const hoursRemaining = (new Date(donation.expiry_time).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursRemaining < 2) score += 10;
  else if (hoursRemaining < 6) score += 6;

  // 3. Trust score factor (+5 points if partner trust > 90)
  if (trustScore >= 90) score += 5;

  const finalPercent = Math.min(99, Math.max(50, Math.round(score)));
  
  let explanation = `Recommended because you are ${distKm} km away and available for pickup.`;
  if (hoursRemaining < 2) {
    explanation = `Urgent rescue match! Expiring in ${Math.round(hoursRemaining * 60)} minutes (${distKm} km away).`;
  }

  return {
    matchScore: finalPercent,
    matchLabel: `${finalPercent}% Match`,
    matchExplanation: explanation,
    distanceKm: distKm
  };
};

// GET /api/partner/dashboard
exports.getDashboard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const role = req.user.role; // 'ngo' or 'volunteer'

    // Fetch or create partner profile
    let partnerInfo = {
      availability: 'online',
      trustScore: 94,
      transportType: role === 'ngo' ? 'van' : 'car',
      capacityKg: role === 'ngo' ? 200 : 50,
      hoursContributed: 38,
      organizationCapacity: role === 'ngo' ? '500 meals/day' : null
    };

    try {
      const [pRows] = await pool.execute(`SELECT * FROM partner_profiles WHERE user_id = ? LIMIT 1`, [userId]);
      if (pRows[0]) {
        partnerInfo = {
          availability: pRows[0].availability,
          trustScore: pRows[0].trust_score,
          transportType: pRows[0].transport_type,
          capacityKg: pRows[0].capacity_kg,
          hoursContributed: pRows[0].hours_contributed,
          organizationCapacity: pRows[0].organization_capacity
        };
      } else {
        // Auto-initialize partner profile
        await pool.execute(
          `INSERT INTO partner_profiles (user_id, transport_type, capacity_kg, availability, trust_score)
           VALUES (?, ?, ?, 'online', 94)
           ON DUPLICATE KEY UPDATE availability = VALUES(availability)`,
          [userId, partnerInfo.transportType, partnerInfo.capacityKg]
        );
      }
    } catch (error) { throw error; }

    // Calculate completed stats
    let pickupsCompleted = 0;
    let activeCount = 0;
    try {
      const [completedRows] = await pool.execute(
        `SELECT COUNT(*) AS count FROM assignments WHERE member_id = ? AND status IN ('COMPLETED', 'DELIVERED', 'completed', 'delivered')`,
        [userId]
      );
      pickupsCompleted = completedRows[0]?.count || 0;

      const [activeRows] = await pool.execute(
        `SELECT COUNT(*) AS count FROM assignments WHERE member_id = ? AND status NOT IN ('COMPLETED', 'CANCELLED', 'completed', 'cancelled')`,
        [userId]
      );
      activeCount = activeRows[0]?.count || 0;
    } catch (error) { throw error; }

    const [availRows] = await pool.execute(`SELECT COUNT(*) AS count FROM donations WHERE status = 'available'`);
    const availableDonations = Number(availRows[0]?.count || 0);

    const [impactRows] = await pool.execute(
      `SELECT COALESCE(SUM(d.number_of_meals), 0) AS meals
       FROM assignments a JOIN donations d ON d.id = a.donation_id
       WHERE a.member_id = ? AND a.status = 'COMPLETED'`,
      [userId]
    );
    const peopleServed = Number(impactRows[0]?.meals || 0);
    const foodRescuedKg = 0;

    return res.json({
      success: true,
      partner: {
        id: userId,
        name: req.user.full_name,
        role: role.toUpperCase(), // 'NGO' or 'VOLUNTEER'
        roleBadge: role === 'ngo' ? 'Verified NGO' : 'Verified Volunteer',
        availability: partnerInfo.availability,
        trustScore: partnerInfo.trustScore,
        transportType: partnerInfo.transportType,
        capacityKg: partnerInfo.capacityKg,
        hoursContributed: partnerInfo.hoursContributed,
        organizationCapacity: partnerInfo.organizationCapacity
      },
      stats: {
        availableDonations,
        activeAssignments: activeCount,
        pickupsCompleted,
        deliveriesCompleted: pickupsCompleted,
        foodRescuedKg,
        peopleServed
      }
    });
  } catch (error) { next(error); }
};

// GET /api/partner/donations
exports.getDonations = async (req, res, next) => {
  try {
    const partnerLat = Number(req.query.latitude || req.user?.latitude || 37.7749);
    const partnerLng = Number(req.query.longitude || req.user?.longitude || -122.4194);
    const sort = req.query.sort || 'best_match';

    const rawList = await Donation.list({ where: "WHERE d.status = 'available'", limit: 50, offset: 0 });

    const donations = rawList.map(d => {
      const match = calculateSmartMatch(d, partnerLat, partnerLng);
      const isUrgent = (new Date(d.expiry_time).getTime() - Date.now()) < 3 * 60 * 60 * 1000;
      return {
        id: d.id,
        foodName: d.food_name,
        category: d.category_name || d.food_type || 'Cooked Meals',
        foodType: d.food_type,
        quantity: d.quantity,
        numberOfMeals: d.number_of_meals || 50,
        donorName: d.business_name || d.full_name || 'Restaurant ABC',
        donorAddress: d.pickup_address || 'Main St',
        latitude: d.latitude,
        longitude: d.longitude,
        distanceKm: match.distanceKm,
        postedTime: d.created_at,
        expiryTime: d.expiry_time,
        isUrgent,
        status: d.status,
        imageUrl: d.food_image || null,
        smartMatch: match
      };
    });

    // Sorting
    if (sort === 'urgent') {
      donations.sort((a, b) => new Date(a.expiryTime).getTime() - new Date(b.expiryTime).getTime());
    } else if (sort === 'nearby') {
      donations.sort((a, b) => a.distanceKm - b.distanceKm);
    } else if (sort === 'best_match') {
      donations.sort((a, b) => b.smartMatch.matchScore - a.smartMatch.matchScore);
    } else {
      donations.sort((a, b) => new Date(b.postedTime).getTime() - new Date(a.postedTime).getTime());
    }

    return res.json({ success: true, donations, count: donations.length });
  } catch (error) { next(error); }
};

// GET /api/partner/donations/:id
exports.getDonationById = async (req, res, next) => {
  try {
    const d = await Donation.findById(req.params.id);
    if (!d) return res.status(404).json({ success: false, message: 'Donation not found.' });

    const images = await Donation.getImages(d.id);
    const partnerLat = Number(req.user?.latitude || 37.7749);
    const partnerLng = Number(req.user?.longitude || -122.4194);
    const match = calculateSmartMatch(d, partnerLat, partnerLng);

    return res.json({
      success: true,
      donation: {
        id: d.id,
        foodName: d.food_name,
        category: d.category_name || d.food_type,
        quantity: d.quantity,
        numberOfMeals: d.number_of_meals,
        description: d.description || 'Fresh surplus meal boxes prepared with strict hygiene standards.',
        preparationTime: d.preparation_time,
        expiryTime: d.expiry_time,
        storageInstructions: d.storage_instructions || 'Keep refrigerated or consume within 4 hours.',
        isVegetarian: d.food_type === 'veg',
        allergens: d.allergens || 'None declared',
        images: images.map(image => image.image_path || image).filter(Boolean),
        donor: {
          id: d.user_id,
          name: d.business_name || d.full_name || 'Restaurant ABC',
          phone: d.mobile || '+1 555-0199',
          pickupAddress: d.pickup_address,
          latitude: d.latitude,
          longitude: d.longitude,
          distanceKm: match.distanceKm
        },
        delivery: {
          destinationName: 'St. Jude Community Kitchen',
          address: '450 Relief Way, Central District',
          contactPhone: '+1 555-0288'
        },
        smartMatch: match
      }
    });
  } catch (error) { next(error); }
};

// POST /api/partner/donations/:id/accept (ATOMIC TRANSACTION & HANDOFF CODE GENERATION)
exports.acceptDonation = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const donationId = req.params.id;
    const partnerId = req.user.id;

    await connection.beginTransaction();

    // Row-level lock to prevent concurrent claims
    const [rows] = await connection.execute(
      `SELECT id, user_id, food_name, pickup_address, status FROM donations WHERE id = ? FOR UPDATE`,
      [donationId]
    );

    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Donation not found.' });
    }

    const donation = rows[0];
    if (donation.status !== 'available') {
      await connection.rollback();
      return res.status(409).json({ success: false, message: '⚠️ This donation was just claimed by another food rescue partner.' });
    }

    // Update donation status to assigned
    await connection.execute(
      `UPDATE donations SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [donationId]
    );

    // Generate independent, unique-to-this-system handoff codes. Only hashes
    // are used for verification; the assigned partner receives the codes to
    // share with the donor and recipient.
    const pickupCode = await createUniqueHandoffCode(connection);
    const deliveryCode = await createUniqueHandoffCode(connection, [pickupCode.hash]);

    // Create assignment row
    const [asgResult] = await connection.execute(
      `INSERT INTO assignments (donation_id, member_id, assigned_by, status, pickup_otp_hash, delivery_otp_hash, pickup_code, delivery_code)
       VALUES (?, ?, ?, 'ASSIGNED', ?, ?, ?, ?)`,
      [donationId, partnerId, partnerId, pickupCode.hash, deliveryCode.hash, pickupCode.code, deliveryCode.code]
    );

    await connection.commit();

    // Real-time notifications
    notifStore.push({
      recipientUserId: partnerId,
      type: 'ASSIGNMENT_CREATED',
      title: '🎯 Mission Accepted!',
      body: `You accepted "${donation.food_name}". Complete pickup verification with the donor before collecting food at ${donation.pickup_address}.`,
      donationId,
      assignmentId: asgResult.insertId
    });

    return res.status(201).json({
      success: true,
      message: 'Donation claimed successfully! Pickup assignment created.',
      assignment: {
        id: asgResult.insertId,
        donationId,
        status: 'ASSIGNED',
        pickupAddress: donation.pickup_address,
        pickupCode: pickupCode.code,
        deliveryCode: deliveryCode.code
      }
    });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};

// GET /api/partner/assignments
exports.getAssignments = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [rows] = await pool.execute(
      `SELECT a.*, d.food_name, d.food_type, d.quantity, d.number_of_meals, d.pickup_address,
              u.business_name AS donor_name, u.mobile AS donor_phone
       FROM assignments a
       JOIN donations d ON a.donation_id = d.id
       JOIN users u ON d.user_id = u.id
       WHERE a.member_id = ?
       ORDER BY a.updated_at DESC`,
      [userId]
    );

    const assignments = await Promise.all(rows.map(row => ensureHandoffCodes(userId, row)));
    return res.json({ success: true, assignments: assignments.map(withoutCodeHashes), count: assignments.length });
  } catch (error) { next(error); }
};

// GET /api/partner/assignments/:id
exports.getAssignmentById = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT a.*, d.food_name, d.food_type, d.quantity, d.number_of_meals, d.pickup_address,
              d.description, u.business_name AS donor_name, u.mobile AS donor_phone
       FROM assignments a
       JOIN donations d ON a.donation_id = d.id
       JOIN users u ON d.user_id = u.id
       WHERE a.id = ? AND a.member_id = ? LIMIT 1`,
      [req.params.id, req.user.id]
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Assignment not found.' });
    const assignment = await ensureHandoffCodes(req.user.id, rows[0]);
    return res.json({ success: true, assignment: withoutCodeHashes(assignment) });
  } catch (error) { next(error); }
};

// POST /api/partner/assignments/:id/start
exports.startNavigation = (req, res, next) => transition(req, res, next, {
  from: ['ASSIGNED'], to: 'GOING_TO_PICKUP', message: 'Navigation started. En route to donor location.'
});

// POST /api/partner/assignments/:id/arrive
exports.arrivePickup = (req, res, next) => transition(req, res, next, {
  from: ['GOING_TO_PICKUP'], to: 'ARRIVED_AT_PICKUP', message: 'Arrived at donor location. Confirm the pickup handoff code.',
  extraSql: 'arrived_at_pickup_at = CURRENT_TIMESTAMP,'
});

// POST /api/partner/assignments/:id/verify-pickup (PICKUP HANDOFF CODE)
exports.verifyPickupCode = async (req, res, next) => {
  try {
    const code = String(req.body.code || req.body.otp || '').trim().toUpperCase();
    if (!isValidHandoffCode(code)) return res.status(422).json({ success: false, message: 'Enter the 8-character pickup handoff code.' });

    const assignment = await ownedAssignment(pool, req.params.id, req.user.id);
    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found.' });
    if (assignment.status !== 'ARRIVED_AT_PICKUP') return res.status(409).json({ success: false, message: 'Arrive at the pickup location before confirming the handoff code.' });
    await ensureHandoffCodes(req.user.id, assignment);
    const [otpRows] = await pool.execute('SELECT pickup_otp_hash FROM assignments WHERE id = ? LIMIT 1', [req.params.id]);
    const pickupOtpHash = otpRows[0]?.pickup_otp_hash;
    if (!pickupOtpHash || hashHandoffCode(code) !== pickupOtpHash) {
      return res.status(400).json({ success: false, message: 'Invalid pickup handoff code. Confirm it with the donor.' });
    }

    await pool.execute(
      `UPDATE assignments SET status = 'FOOD_COLLECTED', pickup_confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [req.params.id]
    );

    return res.json({ success: true, message: 'Pickup handoff code confirmed. Food collected successfully.', status: 'FOOD_COLLECTED' });
  } catch (error) { next(error); }
};

// POST /api/partner/assignments/:id/start-delivery
exports.startDelivery = (req, res, next) => transition(req, res, next, {
  from: ['FOOD_COLLECTED'], to: 'IN_TRANSIT', message: 'Delivery transport started. En route to recipient.'
});

// POST /api/partner/assignments/:id/arrive-destination
exports.arriveDestination = (req, res, next) => transition(req, res, next, {
  from: ['IN_TRANSIT'], to: 'ARRIVED_AT_DESTINATION', message: 'Arrived at destination. Confirm the delivery handoff code.',
  extraSql: 'arrived_at_destination_at = CURRENT_TIMESTAMP,'
});

// POST /api/partner/assignments/:id/verify-delivery (DELIVERY HANDOFF CODE)
exports.verifyDeliveryCode = async (req, res, next) => {
  try {
    const code = String(req.body.code || req.body.otp || '').trim().toUpperCase();
    if (!isValidHandoffCode(code)) return res.status(422).json({ success: false, message: 'Enter the 8-character delivery handoff code.' });

    const assignment = await ownedAssignment(pool, req.params.id, req.user.id);
    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found.' });
    if (assignment.status !== 'ARRIVED_AT_DESTINATION') return res.status(409).json({ success: false, message: 'Arrive at the delivery destination before confirming the handoff code.' });
    await ensureHandoffCodes(req.user.id, assignment);
    const [otpRows] = await pool.execute('SELECT delivery_otp_hash FROM assignments WHERE id = ? LIMIT 1', [req.params.id]);
    if (!otpRows[0]?.delivery_otp_hash || hashHandoffCode(code) !== otpRows[0].delivery_otp_hash) {
      return res.status(400).json({ success: false, message: 'Invalid delivery handoff code. Confirm it with the recipient.' });
    }

    await pool.execute(
      `UPDATE assignments SET status = 'DELIVERED', delivery_confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [req.params.id]
    );

    if (assignment.donation_id) {
      await pool.execute(`UPDATE donations SET status = 'delivered' WHERE id = ? AND status = 'accepted'`, [assignment.donation_id]);
    }

    return res.json({ success: true, message: 'Delivery handoff code confirmed. Food handed over successfully.', status: 'DELIVERED' });
  } catch (error) { next(error); }
};

// POST /api/partner/assignments/:id/proof
exports.uploadProof = async (req, res, next) => {
  try {
    if (!req.file) return res.status(422).json({ success: false, message: 'Proof photo image file is required.' });
    const assignment = await ownedAssignment(pool, req.params.id, req.user.id);
    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found.' });
    if (!['DELIVERED'].includes(assignment.status)) return res.status(409).json({ success: false, message: 'Delivery proof can only be uploaded after delivery verification.' });
    const imageUrl = `/uploads/delivery-proof/${req.file.filename}`;
    const notes = req.body.notes || '';
    const lat = req.body.latitude ? Number(req.body.latitude) : null;
    const lng = req.body.longitude ? Number(req.body.longitude) : null;

    await pool.execute(
      `INSERT INTO proofs (assignment_id, uploaded_by, type, image_url, notes) VALUES (?, ?, 'DELIVERY', ?, ?)`,
      [req.params.id, req.user.id, imageUrl, notes]
    );

    return res.status(201).json({
      success: true,
      message: 'Delivery proof photo uploaded and verified.',
      proofUrl: imageUrl
    });
  } catch (error) { next(error); }
};

// POST /api/partner/assignments/:id/complete
exports.completeAssignment = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const peopleServed = Number.parseInt(req.body.peopleServed, 10);
    const quantityDistributed = String(req.body.quantityDistributed || '').trim();
    if (!quantityDistributed || !Number.isInteger(peopleServed) || peopleServed < 1) {
      return res.status(422).json({ success: false, message: 'Distributed quantity and people served are required.' });
    }
    await connection.beginTransaction();
    const assignment = await ownedAssignment(connection, req.params.id, req.user.id, true);
    if (!assignment) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Assignment not found.' }); }
    if (assignment.status === 'COMPLETED') { await connection.rollback(); return res.status(409).json({ success: false, message: 'This assignment has already been completed.' }); }
    if (assignment.status !== 'DELIVERED') { await connection.rollback(); return res.status(409).json({ success: false, message: 'Verify delivery before completing this assignment.' }); }
    const [proofRows] = await connection.execute(
      `SELECT id FROM proofs WHERE assignment_id = ? AND uploaded_by = ? AND type = 'DELIVERY' LIMIT 1`,
      [assignment.id, req.user.id]
    );
    if (!proofRows.length) { await connection.rollback(); return res.status(422).json({ success: false, message: 'Upload a delivery proof photo before completing this assignment.' }); }
    const [donationRows] = await connection.execute('SELECT id, status FROM donations WHERE id = ? FOR UPDATE', [assignment.donation_id]);
    if (!donationRows.length) { await connection.rollback(); return res.status(404).json({ success: false, message: 'Related donation was not found.' }); }
    if (donationRows[0].status === 'completed') { await connection.rollback(); return res.status(409).json({ success: false, message: 'This donation has already been completed.' }); }
    await connection.execute(`UPDATE assignments SET status = 'COMPLETED', delivery_time = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [assignment.id]);
    await connection.execute(`UPDATE donations SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [assignment.donation_id]);
    await connection.execute(
      `INSERT INTO impact_logs (user_id, donation_id, assignment_id, food_quantity, action) VALUES (?, ?, ?, ?, 'distribution_completed')`,
      [req.user.id, assignment.donation_id, assignment.id, peopleServed]
    );
    await connection.commit();
    notifStore.push({ recipientUserId: req.user.id, type: 'IMPACT_UPDATE', title: 'Impact recorded', body: `${peopleServed} people were served through this completed food rescue.`, donationId: assignment.donation_id, assignmentId: assignment.id });
    return res.json({ success: true, message: 'Distribution completed and impact recorded.', assignment: { id: assignment.id, status: 'COMPLETED', quantityDistributed, peopleServed } });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};

exports.getNotifications = async (req, res, next) => {
  try {
    return res.json({ success: true, notifications: notifStore.getForUser(String(req.user.id), 50) });
  } catch (error) { next(error); }
};

// POST /api/partner/assignments/:id/cancel (BACKUP PARTNER RISK DETECTION)
exports.cancelAssignment = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`SELECT donation_id FROM assignments WHERE id = ? AND member_id = ? LIMIT 1`, [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Assignment not found.' });

    const donationId = rows[0].donation_id;
    await pool.execute(`UPDATE assignments SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [req.params.id]);
    await pool.execute(`UPDATE donations SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [donationId]);

    // Risk detection notification to backup partners
    notifStore.push({
      type: 'REASSIGNMENT_ALERT',
      title: '⚠️ Pickup Risk: Donation Returned to Available Pool',
      body: 'A nearby food rescue donation needs a new partner immediately.',
      donationId
    });

    return res.json({ success: true, message: 'Assignment cancelled. Food donation has been restored to nearby partners.' });
  } catch (error) { next(error); }
};

// GET /api/partner/history
exports.getHistory = async (req, res, next) => {
  try {
    const tab = req.query.tab || 'all';
    let statusFilter = '';
    if (tab === 'completed') statusFilter = "AND status IN ('COMPLETED', 'DELIVERED')";
    if (tab === 'cancelled') statusFilter = "AND status = 'CANCELLED'";

    const [rows] = await pool.execute(
      `SELECT a.*, d.food_name, d.quantity, u.business_name AS donor_name
       FROM assignments a
       JOIN donations d ON a.donation_id = d.id
       JOIN users u ON d.user_id = u.id
       WHERE a.member_id = ? ${statusFilter}
       ORDER BY a.updated_at DESC`,
      [req.user.id]
    );

    return res.json({ success: true, history: rows });
  } catch (error) { next(error); }
};

// GET /api/partner/impact
exports.getImpact = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS count, COALESCE(SUM(d.number_of_meals), 0) AS meals
       FROM assignments a JOIN donations d ON d.id = a.donation_id
       WHERE a.member_id = ? AND a.status = 'COMPLETED'`,
      [userId]
    );
    const count = Number(rows[0]?.count || 0);
    const meals = Number(rows[0]?.meals || 0);

    return res.json({
      success: true,
      impact: {
        foodRescuedKg: 0,
        mealsDelivered: meals,
        successfulPickups: count,
        successfulDeliveries: count,
        peopleSupported: meals,
        estimatedWasteReducedKg: 0,
        monthlyChart: []
      }
    });
  } catch (error) { next(error); }
};

// GET & PUT /api/partner/profile
exports.getProfile = async (req, res, next) => {
  try {
    const [pRows] = await pool.execute(`SELECT * FROM partner_profiles WHERE user_id = ? LIMIT 1`, [req.user.id]);
    const p = pRows[0] || {};
    return res.json({
      success: true,
      profile: {
        id: req.user.id,
        name: req.user.full_name,
        role: req.user.role.toUpperCase(),
        roleBadge: req.user.role === 'ngo' ? 'Verified NGO' : 'Verified Volunteer',
        email: req.user.email,
        phone: req.user.mobile,
        address: req.user.address,
        availability: p.availability || 'online',
        transportType: p.transport_type || 'car',
        capacityKg: p.capacity_kg || 50,
        trustScore: p.trust_score || 94
      }
    });
  } catch (error) { next(error); }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const { availability, transportType, capacityKg } = req.body;
    await pool.execute(
      `UPDATE partner_profiles SET availability = ?, transport_type = ?, capacity_kg = ? WHERE user_id = ?`,
      [availability || 'online', transportType || 'car', capacityKg || 50, req.user.id]
    );
    return res.json({ success: true, message: 'Partner profile updated successfully.' });
  } catch (error) { next(error); }
};
