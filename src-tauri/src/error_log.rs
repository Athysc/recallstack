// Daily backend error log, written beside the running executable.
//
// Requirements (task_20260815_0003): one file per calendar day, named
// exactly `errorlog-yyyy-MM-dd.log` (local date), created only when an
// error actually occurs — never pre-created on launch, never touched on a
// day with zero errors — and all errors for one calendar day appended to
// that same file, rolling to a new file automatically when the date
// changes.
//
// This is intentionally independent of the `tracing`/`tracing-subscriber`
// setup added in task_20260815_0002: that one is optional, gated behind the
// `e2e` Cargo feature, and exists only to surface tauri-plugin-wdio-
// webdriver's own diagnostics during CI e2e runs (with a deliberate
// tracing-log feature exclusion to avoid colliding with tauri-plugin-wdio's
// own logger — see the Cargo.toml comment there). This module is always on,
// has no Cargo feature gate, and every write here is best-effort: any I/O
// failure (permissions, a read-only mount, a bundle directory that can't be
// written to) is swallowed rather than propagated, because a broken error
// logger must never itself crash or block the app it's trying to diagnose.

use chrono::{DateTime, Local, NaiveDate};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Serializes writes across concurrent Tauri commands so two errors logged
/// at nearly the same instant can't interleave their lines. Logging is rare
/// enough (only on error) that a single global lock is not a bottleneck.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// The exact file name for a given calendar date — `errorlog-yyyy-MM-dd.log`.
/// Pure: computing this never touches the filesystem.
pub fn log_file_name(date: NaiveDate) -> String {
    format!("errorlog-{}.log", date.format("%Y-%m-%d"))
}

/// Full path for the given date's log file inside `directory`. Pure.
pub fn log_path_for(directory: &Path, date: NaiveDate) -> PathBuf {
    directory.join(log_file_name(date))
}

/// One formatted log line: `[yyyy-MM-dd HH:MM:SS.mmm] context: message\n`.
/// Millisecond precision is enough to disambiguate ordering for a
/// hand-opened diagnostic log without adding noise; local time, since a
/// day boundary (and the filename itself) is local-date-based — a UTC
/// timestamp inside a locally-dated file would be confusing to read.
pub fn format_entry(timestamp: DateTime<Local>, context: &str, message: &str) -> String {
    format!(
        "[{}] {context}: {message}\n",
        timestamp.format("%Y-%m-%d %H:%M:%S%.3f")
    )
}

/// Appends one entry to `directory`'s log file for `timestamp`'s calendar
/// date, creating that file only now if it doesn't already exist. Never
/// creates or touches any other date's file. Best-effort: I/O failures are
/// reported to stderr (useful when a console is attached, e.g. a debug
/// build or `cargo tauri dev`) but never propagated or panicked on.
///
/// Split out from `append_entry` so tests can inject a fixed timestamp
/// instead of depending on wall-clock time.
pub fn append_entry_at(directory: &Path, timestamp: DateTime<Local>, context: &str, message: &str) {
    let path = log_path_for(directory, timestamp.date_naive());
    let line = format_entry(timestamp, context, message);
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let result = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut file| file.write_all(line.as_bytes()));
    if let Err(error) = result {
        eprintln!(
            "Warning: could not write to error log {}: {error}",
            path.display()
        );
    }
}

/// `append_entry_at` using the real current local time.
pub fn append_entry(directory: &Path, context: &str, message: &str) {
    append_entry_at(directory, Local::now(), context, message);
}

/// The directory beside the running executable — the same place
/// `portable_read_text_from()` (`commands/bridge.rs`) reads sidecar files
/// from. `None` if `current_exe()` or its parent can't be determined; never
/// panics.
///
/// On macOS this resolves to `RecallStack.app/Contents/MacOS/`, which can be
/// read-only once installed/notarized/Gatekeeper-translocated — that's a
/// real limitation of "beside the exe" on that platform specifically (see
/// task_20260815_0003's report), handled here only by `append_entry`'s
/// best-effort behavior: the write is silently skipped rather than failing.
pub fn exe_directory() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(Path::to_path_buf)
}

/// Logs one backend error to today's daily log beside the executable.
/// Silently does nothing if the executable's directory can't be determined
/// (should be rare) — logging must never be a reason for a command to fail.
pub fn log_command_error(context: &str, message: &str) {
    if let Some(directory) = exe_directory() {
        append_entry(&directory, context, message);
    }
}

/// Runs a fallible Tauri command body, logging (and passing through
/// unchanged) any `Err` it produces before returning it to the frontend.
///
/// Deliberately takes a closure rather than being a bare
/// `result.inspect_err(...)` call at a command's tail expression: several
/// commands use `?` partway through their body, and a `?` returns from the
/// *function*, not from a trailing `.inspect_err()` chained onto its last
/// expression — so a tail-only `inspect_err` would miss every early-`?`
/// error path. Wrapping the whole body as a closure passed to `logged()`
/// makes `?` return from the closure instead, so every error path in the
/// body — early `?` returns and the tail expression alike — passes through
/// this one inspection point. See callers across `commands/*.rs` for the
/// `logged("command_name", || { ...original body... })` pattern.
pub fn logged<T>(context: &str, action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    action().inspect_err(|error| log_command_error(context, error))
}

/// Async counterpart to `logged()`, for the handful of `pub async fn`
/// commands — same rationale: wrap the whole body as
/// `logged_async("name", async { ...original body... }).await` so an
/// early `?` inside the async block is caught too, not just the tail
/// expression.
pub async fn logged_async<T>(
    context: &str,
    action: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    action.await.inspect_err(|error| log_command_error(context, error))
}

/// Installs a panic hook that logs the panic to today's error log (in
/// addition to, not instead of, Rust's default hook — which still prints to
/// stderr when a console is attached, e.g. `cargo tauri dev`). Without this,
/// a panic in a portable release build has nowhere to go: this binary is a
/// GUI-subsystem build on Windows in release mode (see `main.rs`), so it
/// has no attached console at all, and a panic would otherwise be
/// completely invisible.
pub fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log_command_error("panic", &info.to_string());
        default_hook(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::{append_entry_at, exe_directory, log_file_name, log_path_for};
    use chrono::{Local, NaiveDate, TimeZone};
    use std::fs;

    fn fixture_dir(name: &str) -> std::path::PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "recallstack-error-log-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(&directory).expect("fixture directory");
        directory
    }

    fn local_at(date: NaiveDate, hour: u32, minute: u32, second: u32) -> chrono::DateTime<Local> {
        Local
            .from_local_datetime(&date.and_hms_opt(hour, minute, second).expect("valid time"))
            .single()
            .expect("unambiguous local time")
    }

    #[test]
    fn file_name_matches_the_exact_requested_format() {
        let date = NaiveDate::from_ymd_opt(2026, 8, 15).expect("valid date");
        assert_eq!(log_file_name(date), "errorlog-2026-08-15.log");

        // Single-digit month/day must still be zero-padded.
        let date = NaiveDate::from_ymd_opt(2026, 1, 5).expect("valid date");
        assert_eq!(log_file_name(date), "errorlog-2026-01-05.log");
    }

    #[test]
    fn log_path_joins_the_directory_and_file_name() {
        let directory = std::path::Path::new("/tmp/some-app-dir");
        let date = NaiveDate::from_ymd_opt(2026, 8, 15).expect("valid date");
        assert_eq!(
            log_path_for(directory, date),
            std::path::PathBuf::from("/tmp/some-app-dir/errorlog-2026-08-15.log")
        );
    }

    #[test]
    fn nothing_is_created_until_the_first_error_is_logged() {
        let directory = fixture_dir("no-precreate");
        let date = NaiveDate::from_ymd_opt(2026, 8, 15).expect("valid date");

        // Merely knowing the path (as e.g. a UI might, or as this test just
        // did via log_path_for) must not create anything.
        assert!(fs::read_dir(&directory).expect("read fixture dir").next().is_none());

        append_entry_at(&directory, local_at(date, 9, 0, 0), "fs_read", "boom");

        let entries: Vec<_> = fs::read_dir(&directory)
            .expect("read fixture dir")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(entries, vec!["errorlog-2026-08-15.log"]);

        fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn a_day_with_zero_errors_produces_zero_files() {
        let directory = fixture_dir("zero-errors");
        // Deliberately never call append_entry_at — this is the whole point
        // of the requirement.
        assert!(fs::read_dir(&directory).expect("read fixture dir").next().is_none());
        fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn multiple_errors_on_the_same_day_append_to_one_file() {
        let directory = fixture_dir("same-day-append");
        let date = NaiveDate::from_ymd_opt(2026, 8, 15).expect("valid date");

        append_entry_at(&directory, local_at(date, 9, 0, 0), "fs_read", "first failure");
        append_entry_at(&directory, local_at(date, 9, 5, 30), "fs_write", "second failure");
        append_entry_at(&directory, local_at(date, 23, 59, 59), "backlinks", "third failure");

        let entries: Vec<_> = fs::read_dir(&directory)
            .expect("read fixture dir")
            .filter_map(Result::ok)
            .collect();
        assert_eq!(entries.len(), 1, "all three errors must land in the same single file");

        let content = fs::read_to_string(log_path_for(&directory, date)).expect("read log");
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 3);
        assert!(lines[0].contains("fs_read: first failure"));
        assert!(lines[1].contains("fs_write: second failure"));
        assert!(lines[2].contains("backlinks: third failure"));
        // Sanity check the timestamp prefix shape (not exact match, since
        // formatting details like millisecond padding are covered by
        // format_entry_has_expected_shape below).
        assert!(lines[0].starts_with("[2026-08-15 09:00:00"));

        fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn crossing_midnight_rolls_to_a_new_file_without_touching_the_old_one() {
        let directory = fixture_dir("midnight-roll");
        let day_one = NaiveDate::from_ymd_opt(2026, 8, 15).expect("valid date");
        let day_two = NaiveDate::from_ymd_opt(2026, 8, 16).expect("valid date");

        append_entry_at(&directory, local_at(day_one, 23, 59, 0), "fs_write", "before midnight");
        append_entry_at(&directory, local_at(day_two, 0, 1, 0), "fs_write", "after midnight");

        let mut names: Vec<String> = fs::read_dir(&directory)
            .expect("read fixture dir")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, vec!["errorlog-2026-08-15.log", "errorlog-2026-08-16.log"]);

        let day_one_content = fs::read_to_string(log_path_for(&directory, day_one)).expect("read day one log");
        assert_eq!(day_one_content.lines().count(), 1);
        assert!(day_one_content.contains("before midnight"));

        let day_two_content = fs::read_to_string(log_path_for(&directory, day_two)).expect("read day two log");
        assert_eq!(day_two_content.lines().count(), 1);
        assert!(day_two_content.contains("after midnight"));

        fs::remove_dir_all(directory).expect("remove fixture");
    }

    #[test]
    fn format_entry_has_expected_shape() {
        let date = NaiveDate::from_ymd_opt(2026, 8, 15).expect("valid date");
        let timestamp = local_at(date, 13, 7, 9);
        let line = super::format_entry(timestamp, "read_note", "not found");
        assert_eq!(line, "[2026-08-15 13:07:09.000] read_note: not found\n");
    }

    #[test]
    fn a_write_failure_does_not_panic() {
        // The directory itself doesn't exist and is never created, so the
        // OpenOptions::open() inside append_entry_at will fail — this must
        // be swallowed (reported to stderr only), never panic or propagate.
        let directory = std::env::temp_dir().join(format!(
            "recallstack-error-log-missing-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        let date = NaiveDate::from_ymd_opt(2026, 8, 15).expect("valid date");
        append_entry_at(&directory, local_at(date, 9, 0, 0), "fs_read", "boom");
        assert!(!directory.exists(), "a nonexistent directory must not be created by a failed log write");
    }

    #[test]
    fn exe_directory_resolves_without_panicking() {
        // Just confirms this never panics in a normal test-runner process —
        // the actual value depends on the test binary's own location, which
        // isn't meaningful to assert on here.
        let _ = exe_directory();
    }
}
