FROM python:3.12-slim
WORKDIR /app

ENV TZ=Asia/Shanghai
ENV TENDER_ROOT_PATH=/apps/tender
ENV PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY frontend-dist/ ./frontend-dist/
RUN mkdir -p /app/data

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
