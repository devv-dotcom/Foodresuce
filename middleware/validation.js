const { body, validationResult } = require('express-validator');
const { ALL_ROLES, BUSINESS_ROLES } = require('../config/roles');

const ROLES = ALL_ROLES;
const mobileRule = /^[0-9+()\-\s]{10,20}$/;
const pincodeRule = /^[A-Za-z0-9\-\s]{4,12}$/;

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  return res.status(422).json({
    success: false,
    message: 'Please correct the highlighted fields.',
    errors: errors.array().map(({ path, msg }) => ({ field: path, message: msg }))
  });
};

const registerValidation = [
  body('fullName').trim().notEmpty().withMessage('Full name is required.').isLength({ max: 120 }),
  body('email').trim().isEmail().withMessage('A valid email is required.').normalizeEmail(),
  body('mobile').trim().matches(mobileRule).withMessage('A valid mobile number is required.'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long.'),
  body('confirmPassword').custom((value, { req }) => value === req.body.password).withMessage('Passwords do not match.'),
  body('role').trim().toLowerCase().isIn(ROLES).withMessage('Please select a valid role.'),
  body('businessName').optional({ checkFalsy: true }).trim().isLength({ max: 160 }),
  body('address').trim().notEmpty().withMessage('Address is required.').isLength({ max: 255 }),
  body('city').trim().notEmpty().withMessage('City is required.').isLength({ max: 100 }),
  body('state').trim().notEmpty().withMessage('State is required.').isLength({ max: 100 }),
  body('pincode').trim().matches(pincodeRule).withMessage('A valid pincode is required.'),
  body('profileImage').optional({ checkFalsy: true }).trim().isURL().withMessage('Profile image must be a valid URL.'),
  handleValidation
];

const loginValidation = [body('email').trim().isEmail().withMessage('A valid email is required.'), body('password').notEmpty().withMessage('Password is required.'), handleValidation];
const emailValidation = [body('email').trim().isEmail().withMessage('A valid email is required.'), handleValidation];
const otpValidation = [body('email').trim().isEmail().withMessage('A valid email is required.'), body('otp').trim().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Enter the 6-digit OTP.'), handleValidation];
const resetPasswordValidation = [body('resetToken').trim().notEmpty().withMessage('Reset token is required.'), body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters long.'), body('confirmPassword').custom((value, { req }) => value === req.body.newPassword).withMessage('Passwords do not match.'), handleValidation];

const businessProfileValidation = [
  body('fullName').trim().notEmpty().withMessage('Owner name is required.').isLength({ max: 120 }),
  body('email').trim().isEmail().withMessage('A valid email is required.').normalizeEmail(),
  body('mobile').trim().matches(mobileRule).withMessage('A valid phone number is required.'),
  body('businessName').trim().notEmpty().withMessage('Business name is required.').isLength({ max: 160 }),
  body('businessType').trim().isIn(BUSINESS_ROLES).withMessage('A valid business type is required.'),
  body('address').trim().notEmpty().withMessage('Address is required.').isLength({ max: 255 }),
  body('city').trim().notEmpty().withMessage('City is required.').isLength({ max: 100 }),
  body('state').trim().notEmpty().withMessage('State is required.').isLength({ max: 100 }),
  body('pincode').trim().matches(pincodeRule).withMessage('A valid pincode is required.'),
  handleValidation
];

const changePasswordValidation = [
  body('currentPassword').notEmpty().withMessage('Current password is required.'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters long.'),
  body('confirmPassword').custom((value, { req }) => value === req.body.newPassword).withMessage('Passwords do not match.'),
  handleValidation
];

const donationValidation = [
  body('foodName').trim().notEmpty().withMessage('Food name is required.').isLength({ max: 160 }),
  body('categoryId').isInt({ min: 1 }).withMessage('A valid category is required.').toInt(),
  body('foodType').isIn(['veg', 'non_veg']).withMessage('Food type must be veg or non_veg.'),
  body('quantity').trim().notEmpty().withMessage('Quantity is required.').isLength({ max: 80 }),
  body('numberOfMeals').optional().isInt({ min: 0 }).toInt(),
  body('preparationTime').isISO8601().withMessage('A valid preparation time is required.'),
  body('expiryTime').isISO8601().withMessage('A valid expiry time is required.'),
  body('pickupDate').isISO8601().withMessage('A valid pickup date is required.'),
  body('pickupTime').matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).withMessage('A valid pickup time is required.'),
  body('pickupDateTime').isISO8601().withMessage('A valid pickup date and time is required.'),
  body('pickupAddress').trim().notEmpty().withMessage('Pickup address is required.').isLength({ max: 255 }),
  body('city').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('pincode').optional({ checkFalsy: true }).trim().matches(pincodeRule),
  body('storage').optional().isIn(['ambient', 'insulated', 'chilled']).withMessage('Choose a valid storage condition.'),
  body('latitude').optional().isFloat({ min: -90, max: 90 }).toFloat(),
  body('longitude').optional().isFloat({ min: -180, max: 180 }).toFloat(),
  body('description').optional().trim().isLength({ max: 3000 }),
  handleValidation
];

const ngoRegistrationValidation = [
  body('fullName').trim().notEmpty().withMessage('Contact name is required.'), body('email').trim().isEmail().withMessage('A valid email is required.').normalizeEmail(),
  body('mobile').trim().matches(mobileRule).withMessage('A valid mobile number is required.'), body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long.'),
  body('confirmPassword').custom((value, { req }) => value === req.body.password).withMessage('Passwords do not match.'), body('ngoName').trim().notEmpty().withMessage('NGO name is required.'),
  body('address').trim().notEmpty().withMessage('Address is required.'), body('city').trim().notEmpty().withMessage('City is required.'), body('state').trim().notEmpty().withMessage('State is required.'), body('pincode').trim().matches(pincodeRule).withMessage('A valid pincode is required.'), handleValidation
];
const ngoProfileValidation = [body('ngoName').trim().notEmpty().withMessage('NGO name is required.'), body('fullName').trim().notEmpty().withMessage('Contact name is required.'), body('mobile').trim().matches(mobileRule).withMessage('A valid mobile number is required.'), body('address').trim().notEmpty().withMessage('Address is required.'), body('city').trim().notEmpty().withMessage('City is required.'), body('state').trim().notEmpty().withMessage('State is required.'), body('pincode').trim().matches(pincodeRule).withMessage('A valid pincode is required.'), handleValidation];
const volunteerRegistrationValidation = [
  body('fullName').trim().notEmpty().withMessage('Full name is required.').isLength({ max: 120 }),
  body('email').trim().isEmail().withMessage('A valid email is required.').normalizeEmail(),
  body('phone').trim().matches(mobileRule).withMessage('A valid phone number is required.'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long.'),
  body('confirmPassword').custom((value, { req }) => value === req.body.password).withMessage('Passwords do not match.'),
  body('address').trim().notEmpty().withMessage('Address is required.').isLength({ max: 255 }),
  body('city').trim().notEmpty().withMessage('City is required.').isLength({ max: 100 }),
  body('state').trim().notEmpty().withMessage('State is required.').isLength({ max: 100 }),
  body('pincode').trim().matches(pincodeRule).withMessage('A valid pincode is required.'),
  body('vehicleType').trim().notEmpty().withMessage('Vehicle type is required.').isLength({ max: 60 }),
  body('drivingLicenseNumber').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  handleValidation
];
const volunteerProfileValidation = [
  body('fullName').trim().notEmpty().withMessage('Full name is required.').isLength({ max: 120 }),
  body('phone').trim().matches(mobileRule).withMessage('A valid phone number is required.'),
  body('address').trim().notEmpty().withMessage('Address is required.').isLength({ max: 255 }),
  body('city').trim().notEmpty().withMessage('City is required.').isLength({ max: 100 }),
  body('state').trim().notEmpty().withMessage('State is required.').isLength({ max: 100 }),
  body('pincode').trim().matches(pincodeRule).withMessage('A valid pincode is required.'),
  body('vehicleType').trim().notEmpty().withMessage('Vehicle type is required.').isLength({ max: 60 }),
  body('drivingLicenseNumber').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  handleValidation
];
const availabilityValidation = [body('availability').trim().toLowerCase().isIn(['online', 'offline', 'busy']).withMessage('Availability must be online, offline, or busy.'), handleValidation];
const deliveryProofValidation = [body('notes').optional({ checkFalsy: true }).trim().isLength({ max: 1000 }).withMessage('Delivery notes must not exceed 1000 characters.'), handleValidation];
const adminLoginValidation = [body('email').trim().isEmail().withMessage('A valid email is required.').normalizeEmail(), body('password').notEmpty().withMessage('Password is required.'), handleValidation];
const categoryCreateValidation = [body('name').trim().notEmpty().withMessage('Category name is required.').isLength({ max: 80 }), handleValidation];
const categoryUpdateValidation = [body('name').optional().trim().notEmpty().withMessage('Category name cannot be empty.').isLength({ max: 80 }), body('isActive').optional().isBoolean().withMessage('isActive must be true or false.').toBoolean(), body().custom(value => Object.keys(value).some(key => ['name', 'isActive'].includes(key))).withMessage('Provide a category name or active status.'), handleValidation];
const donationStatusValidation = [body('status').trim().isIn(['available', 'accepted', 'volunteer_assigned', 'picked_up', 'delivered', 'completed', 'cancelled']).withMessage('A valid donation status is required.'), handleValidation];
const notificationValidation = [body('title').trim().notEmpty().withMessage('Notification title is required.').isLength({ max: 160 }), body('message').trim().notEmpty().withMessage('Notification message is required.').isLength({ max: 5000 }), body('targetRole').optional().isIn(['all', 'business', 'ngo', 'volunteer']).withMessage('A valid notification target role is required.'), body('recipientUserId').optional({ checkFalsy: true }).isInt({ min: 1 }).toInt(), handleValidation];
const contactReplyValidation = [body('replyMessage').trim().notEmpty().withMessage('Reply message is required.').isLength({ max: 5000 }), handleValidation];
const websiteSettingValidation = [body('key').trim().matches(/^[a-zA-Z0-9_.-]{1,100}$/).withMessage('A valid setting key is required.'), body('value').exists().withMessage('A setting value is required.'), handleValidation];
const contactValidation = [body('name').trim().notEmpty().withMessage('Name is required.').isLength({ max: 120 }), body('email').trim().isEmail().withMessage('A valid email is required.').normalizeEmail(), body('subject').trim().notEmpty().withMessage('Subject is required.').isLength({ max: 200 }), body('message').trim().notEmpty().withMessage('Message is required.').isLength({ max: 5000 }), handleValidation];
const chatMessageValidation = [body('message').trim().notEmpty().withMessage('Message cannot be empty.').isLength({ max: 2000 }).withMessage('Messages must not exceed 2,000 characters.'), handleValidation];

module.exports = { ROLES, registerValidation, loginValidation, emailValidation, otpValidation, resetPasswordValidation, businessProfileValidation, changePasswordValidation, donationValidation, ngoRegistrationValidation, ngoProfileValidation, volunteerRegistrationValidation, volunteerProfileValidation, availabilityValidation, deliveryProofValidation, adminLoginValidation, categoryCreateValidation, categoryUpdateValidation, donationStatusValidation, notificationValidation, contactReplyValidation, websiteSettingValidation, contactValidation, chatMessageValidation };
