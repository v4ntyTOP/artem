#!/data/data/com.termux/files/usr/bin/bash

set -e

REPO_URL="https://github.com/ТВОЙ_USERNAME/ТВОЙ_REPOSITORY.git"
BOT_DIR="$HOME/bot"

echo "📦 Установка Telegram-бота..."

pkg update -y
pkg install -y git nodejs ffmpeg python

if [ -d "$BOT_DIR/.git" ]; then
    echo "🔄 Репозиторий уже существует, обновляю..."
    cd "$BOT_DIR"
    git pull
else
    echo "📥 Скачиваю проект..."
    rm -rf "$BOT_DIR"
    git clone "$REPO_URL" "$BOT_DIR"
    cd "$BOT_DIR"
fi

echo "📦 Устанавливаю npm-зависимости..."
npm install

if [ ! -f ".env" ]; then
    cp .env.example .env
fi

echo
echo "🔐 Введи токен Telegram-бота:"
read -r BOT_TOKEN

if [ -z "$BOT_TOKEN" ]; then
    echo "❌ Токен не введён."
    exit 1
fi

printf 'BOT_TOKEN=%s\n' "$BOT_TOKEN" > .env

echo
echo "✅ Установка завершена."
echo "📁 Папка: $BOT_DIR"
echo "🚀 Запуск..."
echo

npm start
