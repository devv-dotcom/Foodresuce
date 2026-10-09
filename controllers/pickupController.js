const path = require('path');
const pool = require('../config/database');
const Volunteer = require('../models/Volunteer');
const PickupRequest = require('../models/PickupRequest');
const DeliveryProof = require('../models/DeliveryProof');
const PickupHistory = require('../models/PickupHistory');
const { sendNotification, awardPoints } = require('../utils/notify');

const calculateDist = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(1));
};

const ensureVolunteer = async (userId, connection) => {
  const volunteer = await Volunteer.findByUserId(userId, connection);
  if (!volunteer) {
    const error = new Error('Volunteer profile not found.');
    error.statusCode = 404;
    throw error;
  }
  return volunteer;
};

const updateLinkedDonation = async (connection, pickup, donationStatus, acceptedStatus) => {
  await connection.execute('UPDATE donations SET status = ? WHERE id = ?', [donationStatus, pickup.donation_id]);
  await connection.execute('UPDATE accepted_donations SET status = ? WHERE donation_id = ?', [acceptedStatus, pickup.donation_id]);
};

const ownedPickup = async (connection, pickupId, volunteerId) => {
  const pickup = await PickupRequest.findById(pickupId, connection, true);
  if (!pickup) return { error: { status: 404, message: 'Pickup request not found.' } };
  if (pickup.volunteer_id !== volunteerId) return { error: { status: 403, message: 'This pickup is not assigned to you.' } };
  return { pickup };
};

exports.getPickupRequests = async (req, res, next) => {
  try {
    await ensureVolunteer(req.user.id, pool);
    const userLat = Number(req.query.latitude) || null;
    const userLon = Number(req.query.longitude) || null;

    let pickups = await PickupRequest.listAvailable(req.query.limit || 50, req.query.offset || 0);

    // Calculate distance and add countdown info
    const now = Date.now();
    pickups = pickups.map(p => {
      let distanceKm = null;
      if (userLat && userLon && p.latitude && p.longitude) {
        distanceKm = calculateDist(userLat, userLon, Number(p.latitude), Number(p.longitude));
      }
      const expiry = p.expiry_time ? new Date(p.expiry_time).getTime() : null;
      const diffMs = expiry ? expiry - now : 0;
      const diffHours = diffMs / 3600000;
      const hrs = Math.max(0, Math.floor(diffMs / 3600000));
      const mins = Math.max(0, Math.floor((diffMs % 3600000) / 60000));

      return {
        ...p,
        distance_km: distanceKm,
        is_urgent: diffHours <= 2.5 && diffHours > 0,
        countdown_text: diffMs <= 0 ? 'Urgent / Expiring' : `${hrs}h ${mins}m left`
      };
    });

    if (userLat && userLon) {
      pickups.sort((a, b) => {
        if (a.is_urgent && !b.is_urgent) return -1;
        if (!a.is_urgent && b.is_urgent) return 1;
        if (a.distance_km !== null && b.distance_km !== null) return a.distance_km - b.distance_km;
        return 0;
      });
    }

    return res.json({ success: true, pickups });
  } catch (error) { next(error); }
};

exports.getPickupById = async (req, res, next) => {
  try {
    const volunteer = await ensureVolunteer(req.user.id, pool);
    const pickup = await PickupRequest.findById(req.params.id);
    if (!pickup) return res.status(404).json({ success: false, message: 'Pickup request not found.' });
    if (pickup.volunteer_id && pickup.volunteer_id !== volunteer.volunteer_id) return res.status(403).json({ success: false, message: 'You do not have permission to view this pickup.' });
    return res.json({ success: true, pickup });
  } catch (error) { next(error); }
};

exports.acceptPickup = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const volunteer = await ensureVolunteer(req.user.id, connection);
    if (volunteer.availability !== 'online') { await connection.rollback(); return res.status(409).json({ success: false, message: 'Set your availability to online before accepting a pickup.' }); }
    const pickup = await PickupRequest.findById(req.params.id, connection, true);
    if (!pickup || pickup.status !== 'pending' || pickup.volunteer_id) { await connection.rollback(); return res.status(409).json({ success: false, message: 'This pickup is no longer available.' }); }
    if (!(await PickupRequest.assign(connection, pickup.id, volunteer.volunteer_id))) { await connection.rollback(); return res.status(409).json({ success: false, message: 'This pickup is no longer available.' }); }
    await Volunteer.setAvailability(connection, volunteer.volunteer_id, 'busy');
    await updateLinkedDonation(connection, pickup, 'volunteer_assigned', 'volunteer_assigned');

    // Notify donor and NGO that volunteer is on the way
    await sendNotification({
      recipientUserId: pickup.business_id,
      title: '🚚 Volunteer Assigned for Pickup!',
      message: `Volunteer ${volunteer.full_name} has accepted your food pickup and is on the way.`,
      connection
    });

    const [ngoUser] = await connection.execute('SELECT user_id, ngo_name FROM ngos WHERE id = ?', [pickup.ngo_id]);
    if (ngoUser.length) {
      await sendNotification({
        recipientUserId: ngoUser[0].user_id,
        title: '🚚 Volunteer Assigned',
        message: `Volunteer ${volunteer.full_name} was assigned to collect donation "${pickup.food_name}".`,
        connection
      });
    }

    await connection.commit();
    return res.json({ success: true, message: 'Pickup Accepted Successfully' });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};

const transition = (fromStatuses, nextStatus, message, setDeliveryTime = false) => async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const volunteer = await ensureVolunteer(req.user.id, connection);
    const result = await ownedPickup(connection, req.params.id, volunteer.volunteer_id);
    if (result.error) { await connection.rollback(); return res.status(result.error.status).json({ success: false, message: result.error.message }); }
    const { pickup } = result;
    const updated = await PickupRequest.updateStatus(connection, pickup.id, volunteer.volunteer_id, fromStatuses, nextStatus, setDeliveryTime ? [new Date()] : []);
    if (!updated) { await connection.rollback(); return res.status(409).json({ success: false, message: `Pickup cannot be marked as ${nextStatus.replace('_', ' ')} from its current status.` }); }
    const donationStatus = nextStatus === 'pickup_started' ? 'volunteer_assigned' : nextStatus === 'food_collected' ? 'picked_up' : 'delivered';
    const acceptedStatus = nextStatus === 'pickup_started' ? 'volunteer_assigned' : nextStatus === 'food_collected' ? 'picked_up' : 'delivered';
    await updateLinkedDonation(connection, pickup, donationStatus, acceptedStatus);
    await connection.commit();
    return res.json({ success: true, message });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};

exports.startPickup = transition(['volunteer_assigned'], 'pickup_started', 'Pickup started successfully.');
exports.collectFood = transition(['pickup_started'], 'food_collected', 'Food collected successfully.');
exports.deliverFood = transition(['food_collected', 'on_the_way'], 'delivered', 'Food delivered successfully.', true);

exports.completePickup = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const volunteer = await ensureVolunteer(req.user.id, connection);
    const result = await ownedPickup(connection, req.params.id, volunteer.volunteer_id);
    if (result.error) { await connection.rollback(); return res.status(result.error.status).json({ success: false, message: result.error.message }); }
    const { pickup } = result;
    if (pickup.status !== 'delivered') { await connection.rollback(); return res.status(409).json({ success: false, message: 'Only delivered pickups can be completed.' }); }
    if (!(await DeliveryProof.exists(pickup.id, connection))) { await connection.rollback(); return res.status(422).json({ success: false, message: 'A delivery proof image is required before completing delivery.' }); }
    if (!(await PickupRequest.updateStatus(connection, pickup.id, volunteer.volunteer_id, ['delivered'], 'completed'))) { await connection.rollback(); return res.status(409).json({ success: false, message: 'Pickup status changed. Please refresh and try again.' }); }
    await updateLinkedDonation(connection, pickup, 'completed', 'completed');
    await PickupHistory.create(connection, pickup);
    await connection.execute('UPDATE volunteers SET completed_deliveries = completed_deliveries + 1, availability = \'online\' WHERE id = ?', [volunteer.volunteer_id]);

    // Award 100 points to volunteer
    await awardPoints(req.user.id, 100, connection);
    // Award 50 bonus points to donor
    await awardPoints(pickup.business_id, 50, connection);

    // Notify donor
    await sendNotification({
      recipientUserId: pickup.business_id,
      title: '🎉 Food Rescue Completed!',
      message: `Your food donation has been safely delivered to ${pickup.ngo_name || 'the NGO'}! You received 50 impact points and your digital certificate is ready.`,
      connection
    });

    // Notify NGO
    const [ngoUser] = await connection.execute('SELECT user_id FROM ngos WHERE id = ?', [pickup.ngo_id]);
    if (ngoUser.length) {
      await sendNotification({
        recipientUserId: ngoUser[0].user_id,
        title: '📦 Delivery Completed',
        message: `Volunteer ${volunteer.full_name} completed delivery for donation #${pickup.donation_id}.`,
        connection
      });
    }

    await connection.commit();
    return res.json({ success: true, message: 'Delivery Completed Successfully! Points awarded.' });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};

exports.uploadDeliveryProof = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'A PNG, JPG, JPEG, or WEBP delivery proof image is required.' });
    await connection.beginTransaction();
    const volunteer = await ensureVolunteer(req.user.id, connection);
    const result = await ownedPickup(connection, req.params.id, volunteer.volunteer_id);
    if (result.error) { await connection.rollback(); return res.status(result.error.status).json({ success: false, message: result.error.message }); }
    if (!['food_collected', 'on_the_way', 'delivered'].includes(result.pickup.status)) { await connection.rollback(); return res.status(409).json({ success: false, message: 'Delivery proof can be added after food has been collected.' }); }
    const imagePath = `/${path.relative(path.join(__dirname, '..'), req.file.path).split(path.sep).join('/')}`;
    await DeliveryProof.upsert(connection, result.pickup.id, imagePath, req.body.notes);
    await connection.commit();
    return res.status(201).json({ success: true, message: 'Delivery proof uploaded successfully.', image: imagePath });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
};

exports.updateLocation = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const volunteer = await ensureVolunteer(req.user.id, connection);
    const { latitude, longitude } = req.body;
    if (!latitude || !longitude) return res.status(422).json({ success: false, message: 'Latitude and longitude are required.' });
    
    await connection.execute(
      `UPDATE pickup_requests
       SET current_latitude = ?, current_longitude = ?, last_location_updated_at = NOW()
       WHERE id = ? AND volunteer_id = ?`,
      [latitude, longitude, req.params.id, volunteer.volunteer_id]
    );

    await connection.execute(
      `UPDATE users SET latitude = ?, longitude = ? WHERE id = ?`,
      [latitude, longitude, req.user.id]
    );

    return res.json({ success: true, message: 'Location updated successfully.' });
  } catch (error) { next(error); } finally { connection.release(); }
};

exports.trackPickup = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT pr.id AS pickup_id, pr.business_id, pr.status, pr.pickup_address, pr.delivery_address,
              pr.current_latitude, pr.current_longitude, pr.last_location_updated_at,
              d.food_name, d.quantity, d.latitude AS donor_latitude, d.longitude AS donor_longitude,
              u_donor.business_name, u_donor.mobile AS donor_phone,
              n.ngo_name, u_ngo.id AS ngo_user_id, u_ngo.mobile AS ngo_phone, u_ngo.latitude AS ngo_latitude, u_ngo.longitude AS ngo_longitude,
              v.user_id AS volunteer_user_id, u_vol.full_name AS volunteer_name, u_vol.mobile AS volunteer_phone, v.vehicle_type
       FROM pickup_requests pr
       JOIN donations d ON d.id = pr.donation_id
       JOIN users u_donor ON u_donor.id = pr.business_id
       JOIN ngos n ON n.id = pr.ngo_id
       JOIN users u_ngo ON u_ngo.id = n.user_id
       LEFT JOIN volunteers v ON v.id = pr.volunteer_id
       LEFT JOIN users u_vol ON u_vol.id = v.user_id
       WHERE pr.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Pickup request not found.' });

    const data = rows[0];
    const isAuthorized = req.user?.role === 'admin'
      || Number(data.business_id) === Number(req.user?.id)
      || Number(data.ngo_user_id) === Number(req.user?.id)
      || Number(data.volunteer_user_id) === Number(req.user?.id);
    if (!isAuthorized) return res.status(403).json({ success: false, message: 'You do not have access to this pickup tracking information.' });
    let distanceKm = null;
    let etaMinutes = null;
    if (data.current_latitude && data.current_longitude && data.ngo_latitude && data.ngo_longitude) {
      distanceKm = calculateDist(Number(data.current_latitude), Number(data.current_longitude), Number(data.ngo_latitude), Number(data.ngo_longitude));
      if (distanceKm !== null) {
        etaMinutes = Math.max(5, Math.round((distanceKm / 25) * 60));
      }
    }

    return res.json({
      success: true,
      tracking: {
        pickupId: data.pickup_id,
        status: data.status,
        foodName: data.food_name,
        quantity: data.quantity,
        origin: {
          name: data.business_name,
          address: data.pickup_address,
          latitude: Number(data.donor_latitude) || null,
          longitude: Number(data.donor_longitude) || null,
          phone: data.donor_phone
        },
        destination: {
          name: data.ngo_name,
          address: data.delivery_address,
          latitude: Number(data.ngo_latitude) || null,
          longitude: Number(data.ngo_longitude) || null,
          phone: data.ngo_phone
        },
        volunteer: data.volunteer_name ? {
          name: data.volunteer_name,
          phone: data.volunteer_phone,
          vehicleType: data.vehicle_type,
          currentLatitude: Number(data.current_latitude) || null,
          currentLongitude: Number(data.current_longitude) || null,
          lastUpdated: data.last_location_updated_at,
          distanceKm,
          etaMinutes
        } : null
      }
    });
  } catch (error) { next(error); }
};
