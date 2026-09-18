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
  chmod 600 .env
  echo "▶ .env 파일을 만들었습니다. 브라우저의 '초기 설정' 화면에서 API 키를 입력하세요."
fi

HOST=$(grep -E '^HOST=' .env | cut -d= -f2); HOST=${HOST:-127.0.0.1}
PORT=$(grep -E '^PORT=' .env | cut -d= -f2); PORT=${PORT:-8000}
echo "▶ http://$HOST:$PORT 에서 실행합니다 (종료: Ctrl+C)"
( sleep 2 && open "http://$HOST:$PORT" 2>/dev/null ) &
exec .venv/bin/uvicorn app.main:app --host "$HOST" --port "$PORT"
