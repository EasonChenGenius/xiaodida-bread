import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMySqlStore } from '../mysql-store.mjs';
import { openStore } from '../storage.mjs';

// Deterministic model of a shared InnoDB row lock, NOT a real MySQL server test.
function simulatedPool() {
  let record, lock = Promise.resolve(), failSave = false;
  const log = [];
  const pool = {
    log, failNextSave() { failSave = true; },
    async execute(sql, values) {
      log.push(sql);
      if (sql.startsWith('CREATE TABLE')) return [{ affectedRows: 0 }];
      if (sql.startsWith('INSERT IGNORE')) {
        if (!record) record = { revision: '0', data: values[0] };
        return [{ affectedRows: 1 }];
      }
      if (sql === 'SELECT 1') return [[{ 1: 1 }]];
      if (sql === 'SELECT revision,data FROM app_state WHERE id=1') return [[...(record ? [{ ...record }] : [])]];
      throw Error('Unexpected query: ' + sql);
    },
    async getConnection() {
      let releaseLock, draft, began = false;
      const unlock = () => { releaseLock?.(); releaseLock = undefined; };
      return {
        async beginTransaction() { began = true; },
        async execute(sql, values) {
          log.push(sql);
          assert.equal(began, true);
          if (sql.endsWith('FOR UPDATE')) {
            const wait = lock;
            lock = new Promise(resolve => { releaseLock = resolve; });
            await wait;
            draft = { ...record };
            return [[{ ...draft }]];
          }
          if (sql.startsWith('UPDATE app_state')) {
            if (failSave) { failSave = false; throw Error('Simulated storage failure'); }
            assert.equal(String(values[1]), draft.revision);
            draft = { revision: String(BigInt(draft.revision) + 1n), data: values[0] };
            return [{ affectedRows: 1 }];
          }
          throw Error('Unexpected transactional query: ' + sql);
        },
        async commit() { record = draft; unlock(); },
        async rollback() { unlock(); },
        release() { unlock(); },
      };
    },
  };
  return pool;
}
const seed = () => ({ demo: false, count: 0, orders: [], sessions: [] });

test('MySQL 适配器（模拟连接）：重启读取、独立快照与多实例原子累加', async () => {
  const pool = simulatedPool();
  const first = await openMySqlStore({ pool, create: seed });
  const second = await openMySqlStore({ pool, create: () => { throw Error('must not reinitialize'); } });
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).transact(async draft => {
    await Promise.resolve();
    draft.count++;
    draft.orders.push({ id: 'synthetic-' + i });
  })));
  assert.equal((await first.getState()).count, 20);
  assert.equal((await second.getState()).orders.length, 20);
  const detached = await first.getState();
  detached.orders.length = 0;
  assert.equal((await first.getState()).orders.length, 20);
  await first.close();
  const restarted = await openMySqlStore({ pool, create: seed });
  assert.equal((await restarted.getState()).count, 20);
  assert.equal(await restarted.ping(), true);
  assert.ok(pool.log.some(sql => sql.includes('FOR UPDATE')));
  assert.ok(pool.log[0].includes('ENGINE=InnoDB'));
});

test('MySQL 适配器（模拟连接）：业务异常或保存失败整笔回滚且释放锁', async () => {
  const pool = simulatedPool(), store = await openMySqlStore({ pool, create: seed });
  await assert.rejects(store.transact(draft => {
    draft.count = 100;
    draft.orders.push({ id: 'must-not-exist' });
    throw Error('业务拒绝');
  }), /业务拒绝/);
  assert.deepEqual(await store.getState(), seed());
  pool.failNextSave();
  await assert.rejects(store.transact(draft => { draft.count = 999; }), /Simulated storage failure/);
  assert.deepEqual(await store.getState(), seed());
  assert.equal(await store.transact(draft => { draft.count = 1; return 'saved'; }), 'saved');
  assert.equal((await store.getState()).count, 1);
});

test('MySQL 适配器（模拟连接）：初始化竞态、会话持久化、拒绝演示库', async () => {
  const pool = simulatedPool();
  const [first, second] = await Promise.all([
    openMySqlStore({ pool, create: seed }), openMySqlStore({ pool, create: seed }),
  ]);
  await first.transact(draft => { draft.sessions.push({ hash: 'synthetic-hash', actor: 'synthetic-buyer', expiresAt: 123 }); });
  assert.equal((await second.getState()).sessions[0].actor, 'synthetic-buyer');
  await assert.rejects(first.transact(draft => { draft.demo = true; }), /不能导入演示/);
  assert.equal((await first.getState()).demo, false);
  await assert.rejects(openMySqlStore({ pool: simulatedPool(), create: () => ({ demo: true }) }), /不能导入演示/);
  await assert.rejects(openMySqlStore({ create: seed }), /MySQL 需要配置/);
});

test('SQLite 异步事务：重读另一进程更新、回滚与异步竞争不覆盖', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'xiaodida-async-store-'));
  const file = join(directory, 'synthetic.sqlite');
  const first = openStore(file, seed), second = openStore(file, seed);
  try {
    await first.transact(draft => { draft.count = 1; });
    await second.transact(draft => { assert.equal(draft.count, 1); draft.count = 2; });
    assert.equal((await first.getState()).count, 2);
    await assert.rejects(first.transact(draft => { draft.count = 9; throw Error('abort'); }), /abort/);
    assert.equal((await second.getState()).count, 2);
    let continueFirst;
    const gate = new Promise(resolve => { continueFirst = resolve; });
    const pending = first.transact(async draft => { draft.count = 100; await gate; });
    await second.transact(draft => { draft.count = 3; });
    continueFirst();
    await assert.rejects(pending, error => error.status === 409);
    assert.equal((await first.getState()).count, 3);
    assert.equal(await first.ping(), true);
  } finally { first.close(); second.close(); rmSync(directory, { recursive: true, force: true }); }
});
