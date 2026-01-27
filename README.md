# 🎯 English Echoling

Advanced English learning with **Shadowing/Echoling** practice using real YouTube clips.

## Features

### 🎙️ Shadowing Mode (核心功能)
- **Listen** → **Echo** → **Compare** 三步驟跟讀練習
- 錄音功能，可錄下自己的跟讀
- 對比原音和自己的錄音
- 視覺化倒數計時

### 🔍 Phrase Search
- 搜尋真實 YouTube 影片中的英文片語
- 支援多種內容風格篩選：
  - 🗣️ Natural (自然對話)
  - 📚 Teaching (教學風格)
  - 🎤 Formal (正式演講)

### 📚 Practice Topics
- **Connected Speech**: reductions, linking, fillers
- **Expressions**: opinions, reactions, transitions
- **Pronunciation**: TH sounds, R sounds, vowels
- **Intonation**: questions, emphasis

### 🎬 Video Controls
- 播放速度控制 (0.5x ~ 1.25x)
- 循環播放模式
- 收藏片段
- 鍵盤快捷鍵

## Quick Start

```bash
# 1. 安裝依賴
npm install

# 2. 初始化資料庫
npm run init-db

# 3. 收集字幕 (需要 yt-dlp)
npm run collect

# 4. 啟動伺服器
npm start
```

Visit http://localhost:3002

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `N` | Next clip |
| `P` | Previous clip |
| `R` | Replay |
| `L` | Loop toggle |
| `S` | Shadowing mode |
| `F` | Favorite |
| `D` | Random clip |

## Content Sources

30 個精選 YouTube 頻道，涵蓋：
- 教育內容 (TED, TED-Ed, Kurzgesagt)
- 科技 (MKBHD, Linus Tech Tips, Fireship)
- Podcast (Lex Fridman, Huberman Lab)
- 新聞 (BBC News, CNN)
- 娛樂 (Netflix, HBO)
- 語言學習 (Rachel's English, English with Lucy)

## Tech Stack

- **Frontend**: HTML, Tailwind CSS, Vanilla JS
- **Backend**: Express.js
- **Database**: SQLite (better-sqlite3)
- **Video**: YouTube IFrame API
- **Audio**: Web Audio API (錄音功能)
