const express = require('express');
const controller = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { registerValidation, loginValidation, emailValidation, otpValidation, resetPasswordValidation } = require('../middleware/validation');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/register', rateLimit({ max: 5, message: 'Too many registration attempts. Please wait before trying again.' }), registerValidation, controller.register);
router.post('/login', rateLimit({ max: 5, message: 'Too many sign-in attempts. Please wait before trying again.' }), loginValidation, controller.login);
router.post('/verify-login-otp', rateLimit({ max: 8, message: 'Too many code attempts. Request a new sign-in code and try again.' }), otpValidation, controller.verifyLoginOtp);
router.post('/resend-login-otp', rateLimit({ max: 3, message: 'Too many code requests. Please wait before requesting another code.' }), emailValidation, controller.resendLoginOtp);
router.post('/logout', authenticate, controller.logout);
router.post('/forgot-password', rateLimit({ max: 3, message: 'Too many reset requests. Please wait before requesting another code.' }), emailValidation, controller.forgotPassword);
router.post('/verify-otp', rateLimit({ max: 8, message: 'Too many code attempts. Request a new reset code and try again.' }), otpValidation, controller.verifyOtp);
router.post('/reset-password', rateLimit({ max: 5, message: 'Too many password reset attempts. Please request a new code and try again.' }), resetPasswordValidation, controller.resetPassword);
router.get('/profile', authenticate, controller.profile);

module.exports = router;
