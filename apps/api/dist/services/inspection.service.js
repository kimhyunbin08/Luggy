import { query } from '../db/pool.js';
import { v4 as uuidv4 } from 'uuid';
export async function createInspection(bookingId, inspectionType, inspectorId) {
    const inspectionId = uuidv4();
    const now = new Date();
    const result = await query(`INSERT INTO inspections 
      (id, booking_id, inspection_type, status, inspector_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`, [inspectionId, bookingId, inspectionType, 'pending', inspectorId, now, now]);
    const row = result.rows[0];
    return {
        id: row.id,
        bookingId: row.booking_id,
        inspectionType: row.inspection_type,
        status: row.status,
        notes: row.notes,
        inspectorId: row.inspector_id,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    };
}
export async function uploadInspectionPhoto(inspectionId, photoUrl) {
    const photoId = uuidv4();
    const result = await query(`INSERT INTO inspection_photos (id, inspection_id, photo_url, uploaded_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     RETURNING *`, [photoId, inspectionId, photoUrl]);
    const row = result.rows[0];
    return {
        id: row.id,
        inspectionId: row.inspection_id,
        photoUrl: row.photo_url,
        uploadedAt: new Date(row.uploaded_at),
    };
}
export async function getInspectionPhotos(inspectionId) {
    const result = await query('SELECT * FROM inspection_photos WHERE inspection_id = $1 ORDER BY uploaded_at ASC', [inspectionId]);
    return result.rows.map((row) => ({
        id: row.id,
        inspectionId: row.inspection_id,
        photoUrl: row.photo_url,
        uploadedAt: new Date(row.uploaded_at),
    }));
}
export async function completeInspection(inspectionId, status = 'approved', notes) {
    await query(`UPDATE inspections 
     SET status = $1, notes = $2, updated_at = CURRENT_TIMESTAMP 
     WHERE id = $3`, [status, notes, inspectionId]);
}
export async function getInspectionById(inspectionId) {
    const result = await query('SELECT * FROM inspections WHERE id = $1', [inspectionId]);
    if (result.rows.length === 0)
        return null;
    const row = result.rows[0];
    return {
        id: row.id,
        bookingId: row.booking_id,
        inspectionType: row.inspection_type,
        status: row.status,
        notes: row.notes,
        inspectorId: row.inspector_id,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    };
}
export async function getBookingInspections(bookingId) {
    const result = await query('SELECT * FROM inspections WHERE booking_id = $1 ORDER BY created_at DESC', [bookingId]);
    return result.rows.map((row) => ({
        id: row.id,
        bookingId: row.booking_id,
        inspectionType: row.inspection_type,
        status: row.status,
        notes: row.notes,
        inspectorId: row.inspector_id,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    }));
}
