-- Food Rescue master database setup
-- Run this file from the project root with the MySQL client, for example:
--   mysql -u root -p < database/foodbridge.sql
--
-- The current module scripts live in database/ and can also be run individually.
-- This bootstrap includes the ordered, additive compatibility/workflow patches
-- so a fresh install does not silently miss tables used by existing features.

SOURCE database/schema.sql;
SOURCE database/business.sql;
SOURCE database/donation_ngo.sql;
SOURCE database/volunteer_pickup.sql;
SOURCE database/admin_module.sql;
SOURCE database/login_otp.sql;
SOURCE database/patch_v2.sql;
SOURCE database/patch_v3.sql;
SOURCE database/patch_v4.sql;
SOURCE database/patch_v5.sql;
