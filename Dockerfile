FROM python:3.11-slim-bookworm
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /lab
RUN apt-get update -qq && apt-get install -y --no-install-recommends tcpdump ca-certificates && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN python -m pip install --no-cache-dir --only-binary=:all: -r requirements.txt
COPY app ./app
COPY trainerapp ./trainerapp
COPY dnp3 ./dnp3
COPY scripts ./scripts
RUN python -m compileall -q app trainerapp dnp3 scripts
EXPOSE 8000 502 4840 20000 8100
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
