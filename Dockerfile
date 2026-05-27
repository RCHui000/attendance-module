FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ATTENDANCE_HOST=0.0.0.0 \
    ATTENDANCE_PORT=8767 \
    ATTENDANCE_DB_PATH=/data/attendance_demo.sqlite3

WORKDIR /app

RUN pip install --no-cache-dir fastapi "uvicorn[standard]"

COPY app.py fastapi_app.py PRD.md /app/
COPY static /app/static

RUN mkdir -p /data

EXPOSE 8767

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; port=os.environ.get('ATTENDANCE_PORT','8767'); urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=3).read(1)"

CMD ["python", "app.py"]
