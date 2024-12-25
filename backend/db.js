const { Pool } = require('pg');
require('dotenv').config();
// const pool = new Pool({
//     user: process.env.DB_USER,
//     host: process.env.DB_HOST,
//     database: process.env.DB_NAME, 
//     password: process.env.DB_PASSWORD, 
//     port: process.env.DB_PORT,
//   });
const pool = new Pool({
  connectionString: "postgresql://lcosik:xau_HfIi7jDcwLzvZUqvvnyv6VJaKSqDTXMu3@us-east-1.sql.xata.sh/mydb:main?sslmode=require",
});


async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        phone_number VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        session_token VARCHAR(255) UNIQUE,
        telegram_session TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function createOrUpdateUser(userData) {
    const { telegram_id, first_name, last_name, phone_number } = userData;
    
    // Add validation for telegram_id
    if (!telegram_id || isNaN(telegram_id)) {
      throw new Error('Invalid telegram_id provided');
    }
    
    const query = `
      INSERT INTO users (telegram_id, first_name, last_name, phone_number)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (telegram_id) 
      DO UPDATE SET 
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        phone_number = EXCLUDED.phone_number
      RETURNING id;
    `;
    
    try {
      const result = await pool.query(query, [telegram_id, first_name, last_name, phone_number]);
      return result.rows[0];
    } catch (error) {
      console.error('Error in createOrUpdateUser:', error);
      throw new Error(`Failed to create/update user: ${error.message}`);
    }
  }

async function saveSession(userId, sessionToken, telegramSession) {
  const query = `
    INSERT INTO sessions (user_id, session_token, telegram_session)
    VALUES ($1, $2, $3)
    ON CONFLICT (session_token)
    DO UPDATE SET 
      telegram_session = EXCLUDED.telegram_session,
      last_used_at = CURRENT_TIMESTAMP
    RETURNING id;
  `;
  
  const result = await pool.query(query, [userId, sessionToken, telegramSession]);
  return result.rows[0];
}

async function getSession(sessionToken) {
  const query = `
    SELECT s.*, u.telegram_id, u.first_name, u.last_name, u.phone_number
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.session_token = $1;
  `;
  
  const result = await pool.query(query, [sessionToken]);
  return result.rows[0];
}

async function deleteSession(sessionToken) {
  const query = 'DELETE FROM sessions WHERE session_token = $1;';
  await pool.query(query, [sessionToken]);
}

module.exports = {
  initializeDatabase,
  createOrUpdateUser,
  saveSession,
  getSession,
  deleteSession,
  pool,
};