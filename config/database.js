const mysql = require('mysql2/promise');
require('dotenv').config();

const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
const isTiDb = Boolean(process.env.TIDB_HOST);
const databaseTls = () => ({
  ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA } : {}),
  rejectUnauthorized: true
});

let pool;

if (dbUrl) {
  pool = mysql.createPool({
    uri: dbUrl,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: 'Z',
    ssl: process.env.DB_SSL === 'false' && process.env.NODE_ENV !== 'production' ? undefined : databaseTls()
  });
} else {
  pool = mysql.createPool({
    host: process.env.TIDB_HOST || process.env.DB_HOST || 'localhost',
    port: Number(process.env.TIDB_PORT || process.env.DB_PORT || 3306),
    user: process.env.TIDB_USER || process.env.DB_USER || 'root',
    password: process.env.TIDB_PASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.TIDB_DATABASE || process.env.DB_NAME || 'foodbridge',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: 'Z',
    ssl: (isTiDb || process.env.DB_SSL === 'true' || process.env.NODE_ENV === 'production') ? databaseTls() : undefined
  });
}

module.exports = pool;
