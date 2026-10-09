'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', 'backend', '.env') });

const pool = require('../config/database');
const { seedAdminAccount } = require('../services/adminSeed');

(async () => {
  try {
    const provisioned = await seedAdminAccount();
    if (!provisioned) {
      console.error('Admin setup skipped: configure ADMIN_PASSWORD before running this command.');
      process.exitCode = 1;
    } else {
      console.log('Administrator account is provisioned. Existing inactive status is preserved.');
    }
  } catch (error) {
    console.error('Admin setup failed.', error.code || 'ADMIN_SETUP_FAILED');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
