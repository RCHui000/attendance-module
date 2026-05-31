import sqlite3, csv, os, sys

# Hardcoded paths for NAS deployment
base = sys.argv[1] if len(sys.argv) > 1 else '/vol1/@team/个人工作文件/惠若超/attendance-module'
db = os.path.join(base, 'data', 'attendance_demo.sqlite3')
out_dir = os.path.join(base, 'backups')
os.makedirs(out_dir, exist_ok=True)

conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row

tables = {
    'timesheets': (
        "SELECT t.id, u.name AS user_name, u.department, t.week_start_date,"
        " t.status, t.remark, t.submitted_at, t.approved_at, t.updated_at"
        " FROM timesheets t JOIN users u ON u.id = t.user_id"
        " ORDER BY t.week_start_date DESC, u.name"
    ),
    'timesheet_entries': (
        "SELECT e.id, e.timesheet_id, p.code AS project_code, p.name AS project_name,"
        " e.work_date, e.hours, e.description"
        " FROM timesheet_entries e JOIN projects p ON p.id = e.project_id"
        " ORDER BY e.timesheet_id, e.work_date"
    ),
    'overtime_entries': (
        "SELECT id, timesheet_id, work_date, overtime_hours, reason, status"
        " FROM overtime_entries ORDER BY timesheet_id, work_date"
    ),
    'workflow_tasks': (
        "SELECT wt.id, wt.workflow_key, wt.target_type, wt.target_id, wt.status,"
        " wt.assignee_role, wt.assignee_user_id, u.name AS assignee_name,"
        " wt.created_at, wt.completed_at, wt.result_action, wt.comment"
        " FROM workflow_tasks wt LEFT JOIN users u ON u.id = wt.assignee_user_id"
        " ORDER BY wt.created_at DESC"
    ),
}

for name, sql in tables.items():
    rows = conn.execute(sql).fetchall()
    if not rows:
        print(f'{name}: 0 rows (empty)')
        continue
    path = os.path.join(out_dir, f'{name}_backup.csv')
    with open(path, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(rows[0].keys())
        for r in rows:
            w.writerow(list(r))
    print(f'{name}: {len(rows)} rows -> {path}')

conn.close()
print('Backup complete.')
