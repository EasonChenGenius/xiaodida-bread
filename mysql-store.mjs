// Small pilot: one locked InnoDB row preserves the existing domain snapshot atomically.
// Every reader reloads MySQL; multiple containers never keep an authoritative local copy.
const tableSQL = `CREATE TABLE IF NOT EXISTS app_state (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  data LONGTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

function decode(record) {
  if (!record) throw Error('数据库尚未初始化');
  const state = JSON.parse(record.data);
  if (!state || typeof state !== 'object' || Array.isArray(state) || state.demo !== false) {
    throw Error('MySQL 仅支持微信正式身份数据，不能导入演示客户或订单');
  }
  return state;
}

export async function openMySqlStore({ config = {}, create, pool: injectedPool } = {}) {
  if (typeof create !== 'function') throw Error('缺少数据库初始化程序');
  let pool = injectedPool;
  if (!pool) {
    if (!config.host || !config.user || !config.password || !config.database) {
      throw Error('MySQL 需要配置 host、user、password、database');
    }
    const { createPool } = await import('mysql2/promise');
    pool = createPool({
      waitForConnections: true, connectionLimit: 5, queueLimit: 100,
      connectTimeout: 10000, ...config, charset: 'utf8mb4',
      supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false,
    });
  }
  const read = async () => {
    const [rows] = await pool.execute('SELECT revision,data FROM app_state WHERE id=1');
    return rows[0];
  };
  try {
    // Uses only the configured existing database; never creates databases or changes users.
    await pool.execute(tableSQL);
    let record = await read();
    if (!record) {
      const state = create();
      decode({ data: JSON.stringify(state) });
      // Multiple containers may start together. Only the first initializer inserts a row.
      await pool.execute('INSERT IGNORE INTO app_state (id,revision,data) VALUES (1,0,?)', [JSON.stringify(state)]);
      record = await read();
    }
    decode(record);
  } catch (error) {
    if (!injectedPool) await pool.end().catch(() => {});
    throw error;
  }
  return {
    kind: 'mysql',
    async getState() { return decode(await read()); },
    async transact(callback) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute('SELECT revision,data FROM app_state WHERE id=1 FOR UPDATE');
        const record = rows[0], draft = decode(record);
        const result = await callback(draft);
        decode({ data: JSON.stringify(draft) });
        const [saved] = await connection.execute(
          'UPDATE app_state SET data=?,revision=revision+1 WHERE id=1 AND revision=?',
          [JSON.stringify(draft), record.revision],
        );
        if (saved.affectedRows !== 1) throw Object.assign(Error('数据已更新，请重新同步后重试'), { status: 409 });
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      } finally { connection.release(); }
    },
    async ping() { await pool.execute('SELECT 1'); return true; },
    // An injected pool is owned by its caller (useful for tests and shared lifecycle).
    async close() { if (!injectedPool) await pool.end(); },
  };
}
