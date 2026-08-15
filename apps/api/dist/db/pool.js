import { Pool } from 'pg';
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/luggy',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});
export async function getConnection() {
    return pool.connect();
}
export async function query(text, params) {
    return pool.query(text, params);
}
export async function closePool() {
    await pool.end();
}
export { pool };
