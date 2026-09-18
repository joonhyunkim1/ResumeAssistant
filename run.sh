#!/usr/bin/env bash
# 자소서 도우미 실행: 가상환경 준비 → 의존성 설치 → 서버 실행
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "▶ 가상환경 생성"
  python3 -m venv .venv
fi
if [ ! -f .venv/.installed ] || [ requirements.txt -nt .venv/.installed ]; then
  echo "▶ 의존성 설치"
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt
  touch .venv/.installed
fi
if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚠️  .env 파일을 만들었습니다. OPENAI_API_KEY를 입력한 뒤 다시 실행하세요."
  exit 1
fi

HOST=$(grep -E '^HOST=' .env | cut -d= -f2); HOST=${HOST:-127.0.0.1}
PORT=$(grep -E '^PORT=' .env | cut -d= -f2); PORT=${PORT:-8000}
echo "▶ http://$HOST:$PORT 에서 실행합니다 (종료: Ctrl+C)"
( sleep 2 && open "http://$HOST:$PORT" 2>/dev/null ) &
exec .venv/bin/uvicorn app.main:app --host "$HOST" --port "$PORT"
