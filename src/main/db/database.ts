import { app } from 'electron'
import path from 'node:path'
import Database from 'better-sqlite3'
import { runMigrations } from './migrations'

let db: Database.Database | null = null

/** 初始化数据库（单例）。db 文件放 userData，绝不放代码目录 */
export function getDb(): Database.Database {
  if (db) return db
  const dbPath = path.join(app.getPath('userData'), 'plan.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

/** 关闭数据库（app 退出前调用） */
export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
