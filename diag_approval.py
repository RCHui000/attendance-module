import sqlite3, sys

base = sys.argv[1] if len(sys.argv) > 1 else '/vol1/@team/个人工作文件/惠若超/attendance-module'
db = base + '/data/attendance_demo.sqlite3'
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row

print("=== ALL TIMESHEETS ===")
for r in conn.execute("""SELECT t.id, u.name, u.department, t.week_start_date,
    t.status, t.submitted_at, t.approved_at
    FROM timesheets t JOIN users u ON u.id=t.user_id
    ORDER BY t.week_start_date DESC, u.name"""):
    print(f"  ts#{r['id']} user={r['name']} dept={r['department']} "
          f"week={r['week_start_date']} status={r['status']} "
          f"submitted={r['submitted_at']} approved={r['approved_at']}")

print("\n=== WORKFLOW TASKS (timesheet only) ===")
for r in conn.execute("""SELECT wt.id, wt.target_id AS ts_id, u.name AS submitter,
    wt.status AS task_status, wt.assignee_user_id, a.name AS assignee_name,
    wt.created_at, wt.completed_at, wt.comment
    FROM workflow_tasks wt
    JOIN timesheets t ON t.id=wt.target_id
    JOIN users u ON u.id=t.user_id
    LEFT JOIN users a ON a.id=wt.assignee_user_id
    WHERE wt.workflow_key='timesheet'
    ORDER BY wt.created_at DESC"""):
    print(f"  task#{r['id']} ts_id={r['ts_id']} submitter={r['submitter']} "
          f"task_status={r['task_status']} assignee={r['assignee_name']}(id={r['assignee_user_id']}) "
          f"created={r['created_at']} completed={r['completed_at']}")

print("\n=== SUBMITTED TIMESHEETS WITHOUT PENDING TASK ===")
for r in conn.execute("""SELECT t.id, u.name, u.department, t.week_start_date,
    t.status, t.submitted_at
    FROM timesheets t JOIN users u ON u.id=t.user_id
    WHERE t.status='submitted'
    AND NOT EXISTS (
        SELECT 1 FROM workflow_tasks wt
        WHERE wt.target_id=t.id AND wt.workflow_key='timesheet' AND wt.status='pending'
    )"""):
    print(f"  MISSING TASK: ts_id={r['id']} user={r['name']} dept={r['department']} "
          f"week={r['week_start_date']} submitted={r['submitted_at']}")

print("\n=== USERS ===")
for r in conn.execute("SELECT id, name, role, department, is_active FROM users ORDER BY id"):
    print(f"  user#{r['id']} name={r['name']} role={r['role']} dept={r['department']} active={r['is_active']}")

print("\n=== EMPLOYEE PROFILES (manager links) ===")
for r in conn.execute("""SELECT ep.user_id, u.name, ep.manager_user_id,
    m.name AS manager_name, ep.org_id, o.org_name
    FROM employee_profiles ep
    JOIN users u ON u.id=ep.user_id
    LEFT JOIN users m ON m.id=ep.manager_user_id
    LEFT JOIN organizations o ON o.id=ep.org_id
    ORDER BY u.id"""):
    print(f"  user={r['name']}(id={r['user_id']}) manager={r['manager_name']}(id={r['manager_user_id']}) "
          f"org={r['org_name']}(id={r['org_id']})")

conn.close()
