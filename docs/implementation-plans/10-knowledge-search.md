# Improvement 10 Implementation Plan: Knowledge-System Search

**Status:** Implemented and verified (2026-08-06)
**Recommended execution point:** Native FTS foundation begins in the performance milestone; advanced query features follow modularization  
**Primary outcome:** Replace full-workspace JavaScript scans with a native, rebuildable knowledge index supporting full text, structured filters, backlinks, broken links, and saved searches.

## Implemented Scope

- Versioned native SQLite schema now stores note metadata, content hashes, normalized folders, task/date/status fields, tags, links, saved searches, and index observability alongside FTS5.
- Bulk reconciliation compares size and nanosecond modification tokens, writes changes transactionally, removes stale related rows, and watcher batches incrementally reindex only affected Markdown files.
- A typed parser accepts quoted phrases plus `tag:`, `folder:`, `is:`, `status:`, `priority:`, `due:`, `created:`, `modified:`, `linksto:`, and `linkedfrom:` filters; unknown or invalid filters return explicit errors.
- Queries compile to parameterized, bounded SQL/FTS, use BM25 ranking, return safe snippets and structured metadata, and support limit/offset continuation with a total count.
- The desktop frontend no longer scans Markdown bodies into JavaScript at workspace startup; it loads a bounded native note catalog for navigation/completion while all searches use the native query API.
- Search results show metadata chips and query help; built-in and user-saved searches are available, and backlinks are displayed on the open note preview.
- Search index rebuild, watcher reconciliation, schema/file/tag/link counts, last-success metadata, and automatic creation/migration support recovery from a missing or older cache.
- Rust tests cover migrations, parsing/errors, metadata/link extraction, structured filtering, adversarial parameterization, incremental equivalence, and a 1,000-note indexing/search benchmark.

## Current Baseline

The original interface recursively reads every Markdown file into a JavaScript `searchIndex`. Rust contains an FTS5 table and search command, but the running interface does not use them. The current native schema is preliminary and updates are not yet driven by the watcher. sql.js/WASM remains active in the desktop runtime.

## Source-of-Truth Rule

Markdown files and assets remain canonical. SQLite is a derived cache that can be deleted and rebuilt. No user-authored content may exist only in the database.

## Proposed Schema

```sql
workspaces(id, root_fingerprint, schema_version)
files(id, workspace_id, path, kind, size, modified_ns, content_hash)
notes(file_id, title, body, frontmatter_json, created_date, modified_date)
tags(file_id, tag)
tasks(file_id, status, priority, start_date, due_date, completed_date)
links(source_file_id, target_path, target_file_id, anchor, kind)
assets(file_id, mime_type)
saved_searches(id, workspace_id, name, query, sort_order)
notes_fts(title, body, tags, content='notes', content_rowid='file_id')
```

Use migrations and record schema version. Store normalized relative paths, while preserving display case where platforms require it.

## Query Language

Initial syntax:

```text
"exact phrase"
tag:ai
folder:tasks
is:task
is:note
is:working
status:backlog
priority:high
due:today
due:overdue
created:2026-08
modified:>=2026-08-01
linksto:"Some Note"
linkedfrom:"Some Note"
```

Free-text terms and filters combine with implicit `AND`. Define escaping and invalid-query errors explicitly. Do not concatenate raw user syntax into SQL.

## Implementation Phases

### Phase 1: Native indexing foundation

This phase overlaps the performance milestone:

1. Finalize migrations and workspace identity.
2. Scan file metadata in bulk.
3. Parse Markdown, frontmatter, task filename metadata, tags, and links in Rust.
4. Update FTS and structured tables in transactions.
5. Report progress and support cancellation.
6. Remove sql.js and the JavaScript full-content index from desktop startup.

### Phase 2: Incremental consistency

1. Index created/modified notes from watcher batches.
2. Remove deleted rows and update rename paths transactionally.
3. Resolve links after changed paths are indexed.
4. Use content hashes/version tokens to avoid reprocessing unchanged files.
5. Reconcile after watcher overflow or interrupted migration.

### Phase 3: Query parser and search API

1. Implement a typed parser producing an AST.
2. Validate field names, operators, dates, and enumerated values.
3. Compile the AST to parameterized SQL/FTS queries.
4. Return ranked results with safe snippets, matched fields, metadata, and total/continuation information.
5. Support cancellation and cap expensive queries.

### Phase 4: Search interface

1. Preserve the top search box for immediate full-text queries.
2. Add filter chips and query-help affordance.
3. Render result type, folder, tags, task metadata, modification date, and highlighted snippet.
4. Add keyboard navigation and command-palette integration.
5. Keep search state when opening a result and returning.

### Phase 5: Backlinks and link health

1. Parse Markdown links, internal path links, and supported wiki-link syntax.
2. Resolve relative paths and anchors consistently with preview behavior.
3. Show backlinks for the open note.
4. Expose broken links, missing anchors, and ambiguous links.
5. Update link rows incrementally after rename/move.

### Phase 6: Saved and specialized searches

1. Save named query strings in workspace settings or a documented settings file.
2. Add built-ins such as Recent Notes, Overdue Tasks, Working Tasks, Broken Links, and Orphan Assets.
3. Support stable sort options.
4. Allow pinning saved searches to navigation.
5. Ensure saved searches are portable/exportable if stored outside Markdown.

### Phase 7: Rebuild and observability

1. Add **Rebuild Search Index** with progress and cancellation.
2. Validate FTS availability at startup.
3. Record index version, last successful reconciliation, file counts, and failures.
4. Surface skipped/unreadable files in workspace health.
5. Recover automatically from a missing or incompatible cache.

## Performance Requirements

- Workspace open must not wait for full-content indexing when a usable index exists.
- Search should begin returning ordinary results within roughly 100 ms on the target workspace after warm-up.
- A one-file change should reindex that file and affected links only.
- Result pages must be bounded; never send the entire result set across IPC.
- Database writes use transactions and prepared statements.

## Testing Strategy

- Migration tests across every schema version.
- Parser tests for valid, invalid, escaped, and adversarial queries.
- Golden tests for Markdown metadata, task filenames, tags, and links.
- Ranking and snippet tests.
- Incremental create/modify/rename/delete tests.
- Full rebuild versus incremental-index equivalence test.
- Benchmarks using a copy/synthetic equivalent of the real workspace.

## Completion Criteria

- Desktop startup no longer builds the JavaScript content index or loads sql.js.
- Full-text and structured filters use native SQLite/FTS5.
- Results update after external filesystem changes.
- Backlinks, broken links, saved searches, task/date filters, and recent files are available.
- The index can be deleted and rebuilt without losing user data.
- Query execution is parameterized, bounded, cancelable where appropriate, and benchmarked.

## Risks and Controls

- **Index drift:** watcher integration plus periodic reconciliation.
- **Schema churn:** numbered migrations and rebuild fallback.
- **Incorrect link resolution:** shared path resolver with preview/editor behavior.
- **Slow complex queries:** AST validation, indexes, limits, and benchmarks.
- **Database lock/corruption:** transactions, WAL policy review, health checks, and cache rebuild.

## Out of Scope

- Vector embeddings or semantic AI search.
- Remote/cloud indexing.
- Graph visualization; the link schema may support it later.
