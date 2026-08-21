'use strict';

async function recordAudit(database, entry) {
  const details = entry.details && typeof entry.details === 'object' ? entry.details : {};
  try {
    await database.query(
      `INSERT INTO admin_audit_logs (admin_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.adminId || null, entry.action, entry.entityType, entry.entityId == null ? null : String(entry.entityId), details]
    );
    return true;
  } catch (err) {
    console.error('[audit] Não foi possível registrar a ação:', err.message);
    return false;
  }
}

module.exports = { recordAudit };
