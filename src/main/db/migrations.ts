import type Database from 'better-sqlite3'

/** 简单版本迁移：user_version 存版本号，逐版本执行 DDL */
export function runMigrations(db: Database.Database): void {
  const version = (db.pragma('user_version', { simple: true }) as number) ?? 0

  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        content       TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'inbox',
        category      TEXT NOT NULL DEFAULT '其他',
        tags          TEXT NOT NULL DEFAULT '[]',
        importance    INTEGER NOT NULL DEFAULT 3,
        urgency       INTEGER NOT NULL DEFAULT 3,
        estimate_min  INTEGER NOT NULL DEFAULT 30,
        due_at        TEXT,
        due_notified  INTEGER NOT NULL DEFAULT 0,
        snooze_count  INTEGER NOT NULL DEFAULT 0,
        ai_status     TEXT NOT NULL DEFAULT 'pending',
        ai_raw        TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        completed_at  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at) WHERE due_at IS NOT NULL;

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    db.pragma('user_version = 1')
  }

  if (version < 2) {
    // v0.2: AI 关键信息提炼（长文本任务的一句话摘要）
    db.exec(`ALTER TABLE tasks ADD COLUMN summary TEXT`)
    db.pragma('user_version = 2')
  }

  if (version < 3) {
    // v0.3: 手动纠正锁定（用户调过的重要性/紧急度，AI 重评不覆盖）
    db.exec(`ALTER TABLE tasks ADD COLUMN manual_locked INTEGER NOT NULL DEFAULT 0`)
    db.pragma('user_version = 3')
  }

  if (version < 4) {
    // v0.4: 项目链条（批量导入的任务成组，推迟上游自动顺延下游）
    db.exec(`
      ALTER TABLE tasks ADD COLUMN project_id TEXT;
      ALTER TABLE tasks ADD COLUMN chain_order INTEGER;
      ALTER TABLE tasks ADD COLUMN chain_total INTEGER;
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id) WHERE project_id IS NOT NULL;
    `)
    db.pragma('user_version = 4')
  }

  if (version < 5) {
    // v0.5: 范围计划（"第 1 周（10/19–10/25）"类：只有范围没有具体天，调度器智能分配）
    db.exec(`
      ALTER TABLE tasks ADD COLUMN range_start TEXT;
      ALTER TABLE tasks ADD COLUMN range_end TEXT;
    `)
    db.pragma('user_version = 5')
  }
  if (version < 6) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE agent_runs (
          id TEXT PRIMARY KEY, goal TEXT NOT NULL, status TEXT NOT NULL,
          messages_json TEXT NOT NULL DEFAULT '[]', pending_json TEXT,
          turns INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE agent_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES agent_runs(id),
          kind TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE INDEX idx_agent_events_run ON agent_events(run_id, id);
        CREATE TABLE agent_actions (
          run_id TEXT NOT NULL REFERENCES agent_runs(id), action_key TEXT NOT NULL,
          result_json TEXT NOT NULL, created_at TEXT NOT NULL,
          PRIMARY KEY (run_id, action_key)
        );
      `)
      db.pragma('user_version = 6')
    })()
  }
}
