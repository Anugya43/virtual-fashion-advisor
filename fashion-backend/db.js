const { Pool } = require("pg");

const { DB_USER, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT } = process.env;
const missing = [];
if (!DB_USER) missing.push('DB_USER');
if (!DB_HOST) missing.push('DB_HOST');
if (!DB_NAME) missing.push('DB_NAME');
if (!DB_PASSWORD) missing.push('DB_PASSWORD');
if (!DB_PORT) missing.push('DB_PORT');
if (missing.length) {
  throw new Error(`Missing required database env vars: ${missing.join(', ')}`);
}

const pool = new Pool({
  user: DB_USER,
  host: DB_HOST,
  database: DB_NAME,
  password: DB_PASSWORD,
  port: Number(DB_PORT),
});

module.exports = pool;