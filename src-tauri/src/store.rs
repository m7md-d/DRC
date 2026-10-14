use crate::model::*;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::{collections::HashMap, path::Path, sync::Mutex};
static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

pub struct Store {
    db: Mutex<Connection>,
    _instance_lock: InstanceLock,
}

struct InstanceLock(std::fs::File);

impl Drop for InstanceLock {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            use std::os::unix::io::AsRawFd;
            // A concurrently spawned helper can briefly inherit this open file
            // description before exec closes it. Release our claim explicitly
            // after the database has closed, even while that alias still exists.
            unsafe { libc::flock(self.0.as_raw_fd(), libc::LOCK_UN) };
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionData {
    pub id: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub snapshot: Option<Discovery>,
    pub command_records: Vec<CommandRecord>,
    pub connection_events: Vec<DeviceEvent>,
    pub smart_reports: HashMap<String, QueryResult>,
    pub connection_report: Option<QueryResult>,
    #[serde(default)]
    pub original_import: Option<String>,
    #[serde(default)]
    pub image_reports: Vec<Value>,
    #[serde(default)]
    pub host_evidence: Vec<Value>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub record_count: i64,
}

impl Store {
    pub fn open(root: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
        let mut options = std::fs::OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        let instance_lock = options
            .open(root.join("instance.lock"))
            .map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::io::AsRawFd;
            if unsafe { libc::flock(instance_lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0
            {
                return Err(
                    "Another DRC process is already using this local session store.".into(),
                );
            }
        }
        let instance_lock = InstanceLock(instance_lock);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        let db = Connection::open(root.join("sessions.sqlite3")).map_err(|e| e.to_string())?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS entries (seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id), kind TEXT NOT NULL, payload TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS session_entries ON entries(session_id,seq);
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS protections (key TEXT PRIMARY KEY, reason TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS extractions (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
            PRAGMA user_version=1;").map_err(|e| e.to_string())?;
        let store = Self {
            db: Mutex::new(db),
            _instance_lock: instance_lock,
        };
        if store.current_id().is_err() {
            store.new_session()?;
        }
        Ok(store)
    }

    pub fn current_id(&self) -> Result<String, String> {
        self.db
            .lock()
            .map_err(|e| e.to_string())?
            .query_row(
                "SELECT value FROM settings WHERE key='current_session'",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())
    }

    pub fn new_session(&self) -> Result<String, String> {
        let mut db = self.db.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let at = now_ms() as i64;
        let id = format!(
            "session-{at}-{}",
            NEXT_SESSION.fetch_add(1, Ordering::Relaxed)
        );
        tx.execute("INSERT INTO sessions VALUES (?1,?2,?2)", params![id, at])
            .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR REPLACE INTO settings VALUES ('current_session',?1)",
            [&id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(id)
    }

    pub fn append<T: Serialize>(&self, kind: &str, value: &T) -> Result<(), String> {
        let payload = serde_json::to_string(value).map_err(|e| e.to_string())?;
        let mut db = self.db.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let id: String = tx
            .query_row(
                "SELECT value FROM settings WHERE key='current_session'",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO entries(session_id,kind,payload) VALUES (?1,?2,?3)",
            params![id, kind, payload],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE sessions SET updated_at=?1 WHERE id=?2",
            params![now_ms() as i64, id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit()
            .map_err(|e| format!("Session could not be saved: {e}"))
    }

    pub fn list(&self) -> Result<Vec<SessionSummary>, String> {
        let db = self.db.lock().map_err(|e| e.to_string())?;
        let mut query = db.prepare("SELECT s.id,s.created_at,s.updated_at,(SELECT COUNT(*) FROM entries e WHERE e.session_id=s.id AND e.kind='command') FROM sessions s ORDER BY s.created_at DESC").map_err(|e| e.to_string())?;
        let rows = query
            .query_map([], |r| {
                Ok(SessionSummary {
                    id: r.get(0)?,
                    created_at: r.get(1)?,
                    updated_at: r.get(2)?,
                    record_count: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn load(&self, id: &str) -> Result<SessionData, String> {
        let db = self.db.lock().map_err(|e| e.to_string())?;
        let (created_at, updated_at) = db
            .query_row(
                "SELECT created_at,updated_at FROM sessions WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        let mut session = SessionData {
            id: id.into(),
            created_at,
            updated_at,
            ..Default::default()
        };
        let mut query = db
            .prepare("SELECT kind,payload FROM entries WHERE session_id=?1 ORDER BY seq")
            .map_err(|e| e.to_string())?;
        let rows = query
            .query_map([id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (kind, payload) = row.map_err(|e| e.to_string())?;
            let parse = |s: &str| serde_json::from_str::<Value>(s).map_err(|e| e.to_string());
            match kind.as_str() {
                "command" => session
                    .command_records
                    .push(serde_json::from_str(&payload).map_err(|e| e.to_string())?),
                "event" => session
                    .connection_events
                    .push(serde_json::from_str(&payload).map_err(|e| e.to_string())?),
                "snapshot" => {
                    session.snapshot =
                        Some(serde_json::from_str(&payload).map_err(|e| e.to_string())?)
                }
                "connection" => {
                    session.connection_report =
                        Some(serde_json::from_str(&payload).map_err(|e| e.to_string())?)
                }
                "import-source" => {
                    session.original_import =
                        Some(serde_json::from_str(&payload).map_err(|e| e.to_string())?)
                }
                "smart" => {
                    let data = parse(&payload)?;
                    let key = data["identityKey"]
                        .as_str()
                        .ok_or("Saved SMART identity is missing")?;
                    session.smart_reports.insert(
                        key.into(),
                        serde_json::from_value(data["result"].clone())
                            .map_err(|e| e.to_string())?,
                    );
                }
                "imageReport" => session.image_reports.push(parse(&payload)?),
                "hostEvidence" => session.host_evidence.push(parse(&payload)?),
                _ => return Err(format!("Unsupported saved entry kind: {kind}")),
            }
        }
        Ok(session)
    }

    pub fn protect(&self, key: &str, reason: &str) -> Result<(), String> {
        self.db
            .lock()
            .map_err(|e| e.to_string())?
            .execute(
                "INSERT OR REPLACE INTO protections VALUES (?1,?2)",
                params![key, reason],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn protection(&self, key: &str) -> Result<Option<String>, String> {
        use rusqlite::OptionalExtension;
        self.db
            .lock()
            .map_err(|e| e.to_string())?
            .query_row("SELECT reason FROM protections WHERE key=?1", [key], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn save_job<T: Serialize>(&self, id: &str, job: &T) -> Result<(), String> {
        let payload = serde_json::to_string(job).map_err(|e| e.to_string())?;
        self.db
            .lock()
            .map_err(|e| e.to_string())?
            .execute(
                "INSERT OR REPLACE INTO jobs VALUES (?1,?2)",
                params![id, payload],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn jobs<T: for<'de> Deserialize<'de>>(&self) -> Result<Vec<T>, String> {
        let db = self.db.lock().map_err(|e| e.to_string())?;
        let mut query = db
            .prepare("SELECT payload FROM jobs ORDER BY rowid DESC")
            .map_err(|e| e.to_string())?;
        let rows = query
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|r| {
            serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
        })
        .collect()
    }

    pub fn save_extraction<T: Serialize>(&self, id: &str, value: &T) -> Result<(), String> {
        self.db
            .lock()
            .map_err(|e| e.to_string())?
            .execute(
                "INSERT OR REPLACE INTO extractions VALUES (?1,?2)",
                params![id, serde_json::to_string(value).map_err(|e| e.to_string())?],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn extractions<T: for<'de> Deserialize<'de>>(&self) -> Result<Vec<T>, String> {
        let db = self.db.lock().map_err(|e| e.to_string())?;
        let mut query = db
            .prepare("SELECT payload FROM extractions ORDER BY rowid DESC")
            .map_err(|e| e.to_string())?;
        let rows = query
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|r| {
            serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
        })
        .collect()
    }

    pub fn import(&self, session: SessionData) -> Result<String, String> {
        let mut db = self.db.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let at = now_ms() as i64;
        let id = format!(
            "import-{at}-{}",
            NEXT_SESSION.fetch_add(1, Ordering::Relaxed)
        );
        tx.execute("INSERT INTO sessions VALUES (?1,?2,?2)", params![id, at])
            .map_err(|e| e.to_string())?;
        let mut entries: Vec<(&str, Value)> = Vec::new();
        if let Some(s) = session.snapshot {
            entries.push((
                "snapshot",
                serde_json::to_value(s).map_err(|e| e.to_string())?,
            ));
        }
        for r in session.command_records {
            entries.push((
                "command",
                serde_json::to_value(r).map_err(|e| e.to_string())?,
            ));
        }
        for e in session.connection_events {
            entries.push(("event", serde_json::to_value(e).map_err(|e| e.to_string())?));
        }
        for (key, result) in session.smart_reports {
            entries.push((
                "smart",
                serde_json::json!({"identityKey":key,"result":result}),
            ));
        }
        if let Some(s) = session.connection_report {
            entries.push((
                "connection",
                serde_json::to_value(s).map_err(|e| e.to_string())?,
            ));
        }
        for report in session.host_evidence {
            entries.push(("hostEvidence", report));
        }
        for report in session.image_reports {
            entries.push(("imageReport", report));
        }
        if let Some(original) = session.original_import {
            entries.push(("import-source", Value::String(original)));
        }
        for (kind, payload) in entries {
            tx.execute(
                "INSERT INTO entries(session_id,kind,payload) VALUES (?1,?2,?3)",
                params![id, kind, payload.to_string()],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn closing_store_releases_claim_with_an_inherited_descriptor() {
        let root = std::env::temp_dir().join(format!(
            "drc-store-inheritance-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let store = Store::open(&root).unwrap();
        // dup and fork refer to the same open file description. Keep that alias
        // alive to reproduce a concurrent helper's brief pre-exec inheritance.
        let inherited = store._instance_lock.0.try_clone().unwrap();
        assert!(Store::open(&root).is_err());
        drop(store);
        let reopened = Store::open(&root).unwrap();
        drop(inherited);
        assert!(Store::open(&root).is_err());
        drop(reopened);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restart_preserves_unknown_values_streams_and_sessions() {
        let root = std::env::temp_dir().join(format!("drc-store-test-{}", now_ms()));
        let store = Store::open(&root).unwrap();
        let first = store.current_id().unwrap();
        let event = DeviceEvent {
            observed_at: 42,
            line: "raw event\u{0000} retained".into(),
        };
        store.append("event", &event).unwrap();
        store.protect("descriptor", "Metadata only").unwrap();
        let original =
            r#"{"unknown_root_field":{"counter":"18446744073709551615"},"stream":"\u0000"}"#;
        let imported = store
            .import(SessionData {
                original_import: Some(original.into()),
                ..Default::default()
            })
            .unwrap();
        drop(store);
        let store = Store::open(&root).unwrap();
        assert_eq!(store.current_id().unwrap(), first);
        assert_eq!(
            store.load(&imported).unwrap().original_import.as_deref(),
            Some(original)
        );
        assert_eq!(
            store.load(&first).unwrap().connection_events[0].line,
            event.line
        );
        assert_eq!(
            store.protection("descriptor").unwrap().as_deref(),
            Some("Metadata only")
        );
        store.new_session().unwrap();
        assert_eq!(store.list().unwrap().len(), 3);
        assert_eq!(store.load(&first).unwrap().connection_events.len(), 1);
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
}
