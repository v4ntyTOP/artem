"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const os = require("os");

const youtubedl = require("youtube-dl-exec");
const { Telegraf, Input } = require("telegraf");

// config
const DATA_FILE = path.join(__dirname, "data.json");
const TEMP_ROOT = path.join(os.tmpdir(), "telegram-personal-downloader");

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_ACTIVE_DOWNLOADS = 3;
const MAX_URL_LENGTH = 4096;

const METADATA_TIMEOUT = 90_000;
const DOWNLOAD_TIMEOUT = 10 * 60 * 1000;

// quality
const QUALITIES = {
  "144": 144,
  "360": 360,
  "480": 480,
  "720": 720,
  "1080": 1080,
  best: Infinity
};

// platforms
const PLATFORMS = [
  {
    id: "youtube",
    name: "YouTube",
    domains: [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "youtu.be"
    ]
  },
  {
    id: "instagram",
    name: "Instagram",
    domains: [
      "instagram.com",
      "www.instagram.com"
    ]
  },
  {
    id: "tiktok",
    name: "TikTok",
    domains: [
      "tiktok.com",
      "www.tiktok.com",
      "vm.tiktok.com"
    ]
  },
  {
    id: "pinterest",
    name: "Pinterest",
    domains: [
      "pinterest.com",
      "www.pinterest.com",
      "pin.it"
    ]
  },
  {
    id: "facebook",
    name: "Facebook",
    domains: [
      "facebook.com",
      "www.facebook.com",
      "fb.watch"
    ]
  },
  {
    id: "x",
    name: "X / Twitter",
    domains: [
      "x.com",
      "www.x.com",
      "twitter.com",
      "www.twitter.com"
    ]
  },
  {
    id: "reddit",
    name: "Reddit",
    domains: [
      "reddit.com",
      "www.reddit.com",
      "redd.it"
    ]
  },
  {
    id: "vimeo",
    name: "Vimeo",
    domains: [
      "vimeo.com",
      "www.vimeo.com"
    ]
  },
  {
    id: "twitch",
    name: "Twitch",
    domains: [
      "twitch.tv",
      "www.twitch.tv"
    ]
  },
  {
    id: "dailymotion",
    name: "Dailymotion",
    domains: [
      "dailymotion.com",
      "www.dailymotion.com",
      "dai.ly"
    ]
  },
  {
    id: "vk",
    name: "VK",
    domains: [
      "vk.com",
      "www.vk.com",
      "vkvideo.ru",
      "www.vkvideo.ru"
    ]
  },
  {
    id: "ok",
    name: "Одноклассники",
    domains: [
      "ok.ru",
      "www.ok.ru"
    ]
  },
  {
    id: "rutube",
    name: "RUTUBE",
    domains: [
      "rutube.ru",
      "www.rutube.ru"
    ]
  },
  {
    id: "likee",
    name: "Likee",
    domains: [
      "likee.video",
      "www.likee.video"
    ]
  },
  {
    id: "bilibili",
    name: "Bilibili",
    domains: [
      "bilibili.com",
      "www.bilibili.com",
      "b23.tv"
    ]
  },
  {
    id: "tumblr",
    name: "Tumblr",
    domains: [
      "tumblr.com",
      "www.tumblr.com"
    ]
  },
  {
    id: "streamable",
    name: "Streamable",
    domains: [
      "streamable.com",
      "www.streamable.com"
    ]
  },
  {
    id: "other",
    name: "Другой сайт",
    domains: []
  }
];

// tokens
function parseTokens(value) {
  return String(value || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

const BOT_TOKENS = parseTokens(process.env.BOT_TOKEN);

if (!BOT_TOKENS.length) {
  console.error("BOT_TOKEN не найден в .env");
  process.exit(1);
}

// filesystem
fs.mkdirSync(TEMP_ROOT, {
  recursive: true
});

// json database
function createEmptyDatabase() {
  return {
    users: {}
  };
}

function saveDatabase(data) {
  const tempFile = `${DATA_FILE}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(
    tempFile,
    DATA_FILE
  );
}

function loadDatabase() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const initial = createEmptyDatabase();

      saveDatabase(initial);

      return initial;
    }

    const raw = fs.readFileSync(
      DATA_FILE,
      "utf8"
    );

    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !== "object"
    ) {
      throw new Error("invalid data");
    }

    if (
      !parsed.users ||
      typeof parsed.users !== "object"
    ) {
      parsed.users = {};
    }

    return parsed;
  } catch (error) {
    console.error(
      "не удалось прочитать data.json, создаю новую базу"
    );

    const fresh = createEmptyDatabase();

    try {
      saveDatabase(fresh);
    } catch (saveError) {
      console.error(
        `не удалось создать data.json: ${saveError.message}`
      );
    }

    return fresh;
  }
}

let database = loadDatabase();
let saveTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    try {
      saveDatabase(database);
    } catch (error) {
      logError(
        "json-save",
        error
      );
    }
  }, 150);
}

function forceSave() {
  try {
    clearTimeout(saveTimer);

    saveDatabase(database);
  } catch (error) {
    logError(
      "json-force-save",
      error
    );
  }
}

// user data
function userKey(
  botKey,
  userId
) {
  return `${botKey}:${userId}`;
}

function getUser(
  botKey,
  userId
) {
  const key = userKey(
    botKey,
    userId
  );

  if (!database.users[key]) {
    database.users[key] = {
      botKey,
      userId,
      keyboardEnabled: true,
      state: {},
      downloads: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    scheduleSave();
  }

  return database.users[key];
}

function updateUser(
  botKey,
  userId,
  changes
) {
  const user = getUser(
    botKey,
    userId
  );

  Object.assign(
    user,
    changes,
    {
      updatedAt: Date.now()
    }
  );

  scheduleSave();

  return user;
}

function getUserState(
  botKey,
  userId
) {
  return getUser(
    botKey,
    userId
  ).state || {};
}

function setUserState(
  botKey,
  userId,
  state
) {
  updateUser(
    botKey,
    userId,
    {
      state: state || {}
    }
  );
}

function clearUserState(
  botKey,
  userId
) {
  setUserState(
    botKey,
    userId,
    {}
  );
}

// helpers
function escapeHtml(value) {
  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    );
}

function shorten(
  value,
  max = 100
) {
  const text = String(
    value || ""
  );

  return text.length > max
    ? `${text.slice(
        0,
        max - 1
      )}…`
    : text;
}

function formatBytes(bytes) {
  if (
    !Number.isFinite(
      bytes
    )
  ) {
    return "неизвестно";
  }

  const units = [
    "Б",
    "КБ",
    "МБ",
    "ГБ"
  ];

  let size = bytes;
  let index = 0;

  while (
    size >= 1024 &&
    index < units.length - 1
  ) {
    size /= 1024;
    index++;
  }

  return `${size.toFixed(
    index === 0 ? 0 : 1
  )} ${units[index]}`;
}

function formatDuration(seconds) {
  const value = Number(
    seconds
  );

  if (
    !Number.isFinite(
      value
    ) ||
    value <= 0
  ) {
    return "неизвестна";
  }

  const total = Math.floor(
    value
  );

  const hours = Math.floor(
    total / 3600
  );

  const minutes = Math.floor(
    (total % 3600) / 60
  );

  const secs =
    total % 60;

  if (hours > 0) {
    return (
      `${hours}:` +
      `${String(
        minutes
      ).padStart(
        2,
        "0"
      )}:` +
      `${String(
        secs
      ).padStart(
        2,
        "0"
      )}`
    );
  }

  return (
    `${minutes}:` +
    `${String(
      secs
    ).padStart(
      2,
      "0"
    )}`
  );
}

// errors
function isIgnoredError(error) {
  const text = String(
    error?.description ||
      error?.message ||
      ""
  ).toLowerCase();

  return [
    "message is not modified",
    "query is too old",
    "query id is invalid",
    "message to edit not found",
    "response timeout expired"
  ].some(
    (part) =>
      text.includes(part)
  );
}

function logError(
  scope,
  error
) {
  if (
    isIgnoredError(
      error
    )
  ) {
    return;
  }

  const text = String(
    error?.description ||
      error?.message ||
      error ||
      "unknown error"
  )
    .replace(
      /\s+/g,
      " "
    )
    .slice(
      0,
      700
    );

  console.error(
    `⚠️ ${scope}: ${text}`
  );
}

async function safeAnswer(
  ctx,
  text = ""
) {
  try {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(
        text
      );
    }
  } catch (error) {
    logError(
      "callback-answer",
      error
    );
  }
}

// url
function normalizeUrl(value) {
  let url = String(
    value || ""
  ).trim();

  if (
    !url ||
    url.length >
      MAX_URL_LENGTH
  ) {
    return null;
  }

  if (
    !/^https?:\/\//i.test(
      url
    )
  ) {
    url =
      `https://${url}`;
  }

  try {
    const parsed =
      new URL(url);

    if (
      ![
        "http:",
        "https:"
      ].includes(
        parsed.protocol
      )
    ) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

// platform
function findPlatform(id) {
  return PLATFORMS.find(
    (platform) =>
      platform.id === id
  );
}

function isCorrectPlatform(
  platform,
  url
) {
  if (!platform) {
    return false;
  }

  if (
    platform.id ===
    "other"
  ) {
    return true;
  }

  try {
    const hostname =
      new URL(
        url
      ).hostname.toLowerCase();

    return platform.domains.some(
      (domain) => {
        const target =
          domain.toLowerCase();

        return (
          hostname ===
            target ||
          hostname.endsWith(
            `.${target}`
          )
        );
      }
    );
  } catch {
    return false;
  }
}

// buttons
function replyButton(
  text,
  style
) {
  return {
    text,
    ...(style
      ? {
          style
        }
      : {})
  };
}

function inlineButton(
  text,
  callback,
  style
) {
  return {
    text,
    callback_data:
      callback,
    ...(style
      ? {
          style
        }
      : {})
  };
}

// reply keyboard
function buildReplyKeyboard(
  enabled
) {
  if (!enabled) {
    return {
      remove_keyboard:
        true
    };
  }

  return {
    keyboard: [
      [
        replyButton(
          "⬇️ Скачать видео",
          "primary"
        )
      ],
      [
        replyButton(
          "⚙️ Настройки"
        ),
        replyButton(
          "❓ Помощь"
        )
      ],
      [
        replyButton(
          "🔄 Сбросить действие"
        )
      ]
    ],
    resize_keyboard:
      true,
    is_persistent:
      true,
    input_field_placeholder:
      "Выберите действие…"
  };
}

// inline keyboards
function homeKeyboard() {
  return {
    inline_keyboard: [
      [
        inlineButton(
          "⬇️ Скачать видео",
          "nav:download",
          "primary"
        )
      ],
      [
        inlineButton(
          "⚙️ Настройки",
          "nav:settings"
        ),
        inlineButton(
          "❓ Помощь",
          "nav:help"
        )
      ]
    ]
  };
}

function settingsKeyboard(
  enabled
) {
  return {
    inline_keyboard: [
      [
        inlineButton(
          enabled
            ? "🔕 Выключить клавиатуру"
            : "🔔 Включить клавиатуру",
          "settings:toggle",
          enabled
            ? "danger"
            : "success"
        )
      ],
      [
        inlineButton(
          "⬅️ Назад",
          "nav:home"
        )
      ]
    ]
  };
}

function platformsKeyboard() {
  const buttons =
    PLATFORMS
      .filter(
        (platform) =>
          platform.id !==
          "other"
      )
      .map(
        (platform) =>
          inlineButton(
            platform.name,
            `platform:${platform.id}`
          )
      );

  const rows = [];

  for (
    let i = 0;
    i < buttons.length;
    i += 2
  ) {
    rows.push(
      buttons.slice(
        i,
        i + 2
      )
    );
  }

  rows.push([
    inlineButton(
      "🌐 Другой сайт",
      "platform:other"
    )
  ]);

  rows.push([
    inlineButton(
      "⬅️ Назад",
      "nav:home"
    )
  ]);

  return {
    inline_keyboard:
      rows
  };
}

function qualityKeyboard() {
  return {
    inline_keyboard: [
      [
        inlineButton(
          "144p",
          "quality:144"
        ),
        inlineButton(
          "360p",
          "quality:360"
        ),
        inlineButton(
          "480p",
          "quality:480"
        )
      ],
      [
        inlineButton(
          "720p",
          "quality:720",
          "primary"
        ),
        inlineButton(
          "1080p",
          "quality:1080"
        ),
        inlineButton(
          "Максимум",
          "quality:best",
          "success"
        )
      ],
      [
        inlineButton(
          "⬅️ Назад",
          "nav:platforms"
        )
      ]
    ]
  };
}

function afterDownloadKeyboard() {
  return {
    inline_keyboard: [
      [
        inlineButton(
          "⬇️ Скачать ещё",
          "nav:platforms",
          "primary"
        )
      ],
      [
        inlineButton(
          "🏠 Главное меню",
          "nav:home"
        )
      ]
    ]
  };
}

// telegram helpers
async function replyHtml(
  ctx,
  html,
  options = {}
) {
  const user =
    getUser(
      ctx.state.botKey,
      ctx.from.id
    );

  return ctx.reply(
    html,
    {
      parse_mode:
        "HTML",
      ...options,
      reply_markup:
        options.reply_markup !==
        undefined
          ? options.reply_markup
          : buildReplyKeyboard(
              user.keyboardEnabled
            )
    }
  );
}

// отправка сообщения только с inline клавиатурой
async function replyInlineHtml(
  ctx,
  html,
  keyboard
) {
  return ctx.reply(
    html,
    {
      parse_mode:
        "HTML",
      reply_markup:
        keyboard
    }
  );
}

async function editHtml(
  ctx,
  html,
  keyboard
) {
  return ctx.editMessageText(
    html,
    {
      parse_mode:
        "HTML",
      ...(keyboard
        ? {
            reply_markup:
              keyboard
          }
        : {})
    }
  );
}

// active downloads
const activeDownloads =
  new Set();

function downloadKey(ctx) {
  return (
    `${ctx.state.botKey}:` +
    `${ctx.from.id}`
  );
}

// home
async function showHome(ctx) {
  const text =
    "🏠 <b>Главное меню</b>\n\n" +
    "📥 Скачивай видео и материалы с популярных площадок\n\n" +
    "⚡ Выбери нужное действие ниже";

  if (ctx.callbackQuery) {
    return editHtml(
      ctx,
      text,
      homeKeyboard()
    );
  }

  return replyHtml(
    ctx,
    text
  );
}

// help
async function showHelp(
  ctx,
  edit = false
) {
  const text =
    "❓ <b>Помощь</b>\n\n" +
    "1️⃣ Нажми <b>«⬇️ Скачать видео»</b>\n" +
    "2️⃣ Выбери площадку\n" +
    "3️⃣ Отправь ссылку\n" +
    "4️⃣ Выбери качество\n" +
    "5️⃣ Дождись окончания загрузки\n\n" +
    "⚠️ Используй бота только для материалов, которые тебе разрешено сохранять";

  if (edit) {
    return editHtml(
      ctx,
      text,
      {
        inline_keyboard: [
          [
            inlineButton(
              "⬅️ Назад",
              "nav:home"
            )
          ]
        ]
      }
    );
  }

  return replyHtml(
    ctx,
    text
  );
}

// settings
async function showSettings(
  ctx,
  edit = false
) {
  const user =
    getUser(
      ctx.state.botKey,
      ctx.from.id
    );

  const text =
    "⚙️ <b>Настройки</b>\n\n" +
    `🎛️ Reply-клавиатура: <b>${
      user.keyboardEnabled
        ? "включена"
        : "выключена"
    }</b>\n\n` +
    "💾 Состояние сохраняется в <code>data.json</code>\n\n" +
    "⌨️ Быстро переключить клавиатуру можно командой <code>/keyboard</code>";

  if (edit) {
    return editHtml(
      ctx,
      text,
      settingsKeyboard(
        user.keyboardEnabled
      )
    );
  }

  return replyHtml(
    ctx,
    text
  );
}

// platform selection
async function showPlatforms(
  ctx
) {
  setUserState(
    ctx.state.botKey,
    ctx.from.id,
    {
      step:
        "platform"
    }
  );

  const text =
    "📥 <b>Скачать видео</b>\n\n" +
    "🌐 Выбери площадку, с которой нужно скачать материал\n\n" +
    "📦 Если нужной площадки нет в списке, выбери <b>«Другой сайт»</b>";

  if (ctx.callbackQuery) {
    return editHtml(
      ctx,
      text,
      platformsKeyboard()
    );
  }

  // здесь обязательно отправляется inline меню
  return replyInlineHtml(
    ctx,
    text,
    platformsKeyboard()
  );
}

// url input
async function askUrl(
  ctx,
  platformId
) {
  const platform =
    findPlatform(
      platformId
    );

  if (!platform) {
    await safeAnswer(
      ctx,
      "Площадка не найдена"
    );

    return;
  }

  setUserState(
    ctx.state.botKey,
    ctx.from.id,
    {
      step:
        "url",
      waitingForUrl:
        true,
      platformId:
        platform.id
    }
  );

  const text =
    `🔗 <b>${escapeHtml(
      platform.name
    )}</b>\n\n` +
    "📨 Отправь ссылку одним сообщением\n\n" +
    "⬅️ Для возврата используй кнопку ниже";

  return editHtml(
    ctx,
    text,
    {
      inline_keyboard: [
        [
          inlineButton(
            "⬅️ Назад",
            "nav:platforms"
          )
        ]
      ]
    }
  );
}

// metadata
async function fetchMetadata(
  url
) {
  const result =
    await youtubedl(
      url,
      {
        dumpSingleJson:
          true,
        skipDownload:
          true,
        noPlaylist:
          true,
        noWarnings:
          true,
        quiet:
          true,
        retries:
          2,
        extractorRetries:
          2,
        socketTimeout:
          25
      },
      {
        timeout:
          METADATA_TIMEOUT,
        killSignal:
          "SIGKILL"
      }
    );

  if (
    !result ||
    typeof result !==
      "object"
  ) {
    throw new Error(
      "metadata unavailable"
    );
  }

  return result;
}

// format
function buildFormat(height) {
  if (height === Infinity) {
    return "bv*+ba/b";
  }

  return [
    `bv*[height<=${height}]+ba`,
    `b[height<=${height}]`,
    "b"
  ].join("/");
}

// file search
function findMediaFile(
  directory
) {
  const files =
    fs.readdirSync(
      directory
    )
      .map(
        (file) =>
          path.join(
            directory,
            file
          )
      )
      .filter(
        (file) => {
          try {
            return fs.statSync(
              file
            ).isFile();
          } catch {
            return false;
          }
        }
      );

  if (!files.length) {
    return null;
  }

  files.sort(
    (a, b) =>
      fs.statSync(
        b
      ).size -
      fs.statSync(
        a
      ).size
  );

  return files[0];
}

// download
async function downloadVideo(
  url,
  quality,
  directory
) {
  const output = path.join(
    directory,
    "video.%(ext)s"
  );

  const format = buildFormat(
    quality
  );

  await youtubedl(
    url,
    {
      format,

      output,

      mergeOutputFormat:
        "mp4",

      noPlaylist:
        true,

      noWarnings:
        true,

      quiet:
        true,

      restrictFilenames:
        true,

      retries:
        2,

      fragmentRetries:
        2,

      extractorRetries:
        2,

      socketTimeout:
        30,

      concurrentFragments:
        4
    },
    {
      timeout:
        DOWNLOAD_TIMEOUT,

      killSignal:
        "SIGKILL"
    }
  );

  const file =
    findMediaFile(
      directory
    );

  if (!file) {
    throw new Error(
      "downloaded file not found"
    );
  }

  return {
    filePath:
      file,

    size:
      fs.statSync(file).size
  };
}

// download error text
function getDownloadError(
  error
) {
  const text =
    String(
      error?.stderr ||
        error?.message ||
        error ||
        ""
    ).toLowerCase();

  if (
    text.includes(
      "unsupported url"
    )
  ) {
    return "🌐 Эта ссылка не поддерживается";
  }

  if (
    text.includes(
      "video unavailable"
    ) ||
    text.includes(
      "not available"
    )
  ) {
    return "🚫 Материал недоступен или удалён";
  }

  if (
    text.includes(
      "private"
    )
  ) {
    return "🔒 Материал закрытый";
  }

  if (
    text.includes(
      "login"
    ) ||
    text.includes(
      "sign in"
    ) ||
    text.includes(
      "authentication"
    )
  ) {
    return "🔐 Для этого материала требуется авторизация";
  }

  if (
    text.includes(
      "rate limit"
    ) ||
    text.includes(
      "too many requests"
    )
  ) {
    return "🚦 Площадка временно ограничила запросы";
  }

  if (
    text.includes(
      "timeout"
    ) ||
    text.includes(
      "timed out"
    )
  ) {
    return "⏱️ Загрузка превысила допустимое время";
  }

  if (
    text.includes(
      "ffmpeg"
    )
  ) {
    return "🛠️ FFmpeg не смог обработать видео, проверь его установку в Termux";
  }

  return "⚠️ Не удалось скачать материал, попробуй другую ссылку или более низкое качество";
}

// handle url

async function handleUrl(ctx, input) {
  const state = getUserState(
    ctx.state.botKey,
    ctx.from.id
  );

  if (
    !state?.waitingForUrl ||
    !state?.platformId
  ) {
    await replyHtml(
      ctx,
      "🏠 Сначала выбери площадку через <b>«⬇️ Скачать видео»</b>"
    );

    return;
  }

  const url = normalizeUrl(input);

  if (!url) {
    await replyHtml(
      ctx,
      "⚠️ Не удалось распознать ссылку\n\n🔗 Отправь корректную HTTP/HTTPS-ссылку"
    );

    return;
  }

  const platform = findPlatform(
    state.platformId
  );

  if (
    !platform ||
    !isCorrectPlatform(
      platform,
      url
    )
  ) {
    await replyHtml(
      ctx,
      `⚠️ Эта ссылка не соответствует выбранной площадке <b>${escapeHtml(
        platform?.name || "площадке"
      )}</b>\n\n⬅️ Вернись назад и выбери правильную площадку`
    );

    return;
  }

  setUserState(
    ctx.state.botKey,
    ctx.from.id,
    {
      step: "quality",
      platformId: platform.id,
      url,
      title: ""
    }
  );

  try {
    await ctx.reply(
      "🎬 <b>Ссылка принята</b>\n\n" +
      `🌐 Площадка: <b>${escapeHtml(
        platform.name
      )}</b>\n\n` +
      "🎚️ Выбери качество загрузки",

      {
        parse_mode: "HTML",
        reply_markup: qualityKeyboard()
      }
    );
  } catch (error) {
    logError(
      "quality-menu",
      error
    );
  }
}

// start download
async function startDownload(
  ctx,
  qualityKey
) {
  const state =
    getUserState(
      ctx.state.botKey,
      ctx.from.id
    );

  const quality =
    QUALITIES[
      qualityKey
    ];

  if (
    !state?.url ||
    !state?.platformId ||
    quality ===
      undefined
  ) {
    await safeAnswer(
      ctx,
      "Данные загрузки устарели"
    );

    return;
  }

  const key =
    downloadKey(ctx);

  if (
    activeDownloads.has(
      key
    )
  ) {
    await safeAnswer(
      ctx,
      "Загрузка уже выполняется"
    );

    return;
  }

  if (
    activeDownloads.size >=
    MAX_ACTIVE_DOWNLOADS
  ) {
    await safeAnswer(
      ctx,
      "Все слоты загрузки заняты"
    );

    return;
  }

  activeDownloads.add(
    key
  );

  await safeAnswer(
    ctx,
    "Загрузка запущена"
  );

  const title =
    state.title ||
    "Видео";

  const qualityText =
    qualityKey ===
      "best"
      ? "максимум"
      : `${qualityKey}p`;

  const directory =
    path.join(
      TEMP_ROOT,

      `${ctx.state.botKey}-${ctx.from.id}-${Date.now()}`
    );

  fs.mkdirSync(
    directory,
    {
      recursive:
        true
    }
  );

  try {
    await ctx.telegram.editMessageText(
      ctx.chat.id,

      ctx.callbackQuery
        .message
        .message_id,

      undefined,

      "⬇️ <b>Скачиваю материал…</b>\n\n" +
        `🎬 ${escapeHtml(
          shorten(
            title,
            100
          )
        )}\n` +
        `🎚️ Качество: <b>${escapeHtml(
          qualityText
        )}</b>\n\n` +
        "⏳ Дождись окончания обработки",

      {
        parse_mode:
          "HTML"
      }
    );

    const result =
      await downloadVideo(
        state.url,
        quality,
        directory
      );

    if (
      result.size >
      MAX_FILE_SIZE
    ) {
      clearUserState(
        ctx.state.botKey,
        ctx.from.id
      );

      await ctx.telegram.editMessageText(
        ctx.chat.id,

        ctx.callbackQuery
          .message
          .message_id,

        undefined,

        "📦 <b>Файл слишком большой</b>\n\n" +
          `📏 Размер: <b>${escapeHtml(
            formatBytes(
              result.size
            )
          )}</b>\n\n` +
          "🎚️ Попробуй выбрать более низкое качество",

        {
          parse_mode:
            "HTML",

          reply_markup: {
            inline_keyboard: [
              [
                inlineButton(
                  "🎚️ Начать заново",
                  "nav:platforms",
                  "primary"
                )
              ],
              [
                inlineButton(
                  "🏠 Главное меню",
                  "nav:home"
                )
              ]
            ]
          }
        }
      );

      return;
    }

    const username =
      ctx.botInfo?.username
        ? `@${ctx.botInfo.username}`
        : "бот";

    const caption =
      "✅ <b>Видео готово</b>\n\n" +
      `🎬 <b>${escapeHtml(
        shorten(
          title,
          100
        )
      )}</b>\n` +
      `🎚️ Качество: <b>${escapeHtml(
        qualityText
      )}</b>\n` +
      `📦 Размер: <b>${escapeHtml(
        formatBytes(
          result.size
        )
      )}</b>\n\n` +
      `📥 Скачано в <b>${escapeHtml(
        username
      )}</b>`;

    await ctx.replyWithVideo(
      Input.fromLocalFile(
        result.filePath
      ),
      {
        caption,
        parse_mode:
          "HTML",
        supports_streaming:
          true,
        reply_markup:
          buildReplyKeyboard(
            getUser(
              ctx.state.botKey,
              ctx.from.id
            ).keyboardEnabled
          )
      }
    );

    const user =
      getUser(
        ctx.state.botKey,
        ctx.from.id
      );

    user.downloads =
      Number(
        user.downloads || 0
      ) + 1;

    user.updatedAt =
      Date.now();

    clearUserState(
      ctx.state.botKey,
      ctx.from.id
    );

    scheduleSave();

    await ctx.telegram.editMessageText(
      ctx.chat.id,

      ctx.callbackQuery
        .message
        .message_id,

      undefined,

      "✅ <b>Готово</b>\n\n📥 Файл отправлен выше\n\n🚀 Можешь скачать ещё один материал",

      {
        parse_mode:
          "HTML",

        reply_markup:
          afterDownloadKeyboard()
      }
    );
  } catch (error) {
    logError(
      "download",
      error
    );

    clearUserState(
      ctx.state.botKey,
      ctx.from.id
    );

    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,

        ctx.callbackQuery
          .message
          .message_id,

        undefined,

        "❌ <b>Не удалось скачать материал</b>\n\n" +
          escapeHtml(
            getDownloadError(
              error
            )
          ),

        {
          parse_mode:
            "HTML",

          reply_markup: {
            inline_keyboard: [
              [
                inlineButton(
                  "🔄 Попробовать снова",
                  "nav:platforms",
                  "primary"
                )
              ],
              [
                inlineButton(
                  "🏠 Главное меню",
                  "nav:home"
                )
              ]
            ]
          }
        }
      );
    } catch (editError) {
      logError(
        "download-edit",
        editError
      );
    }
  } finally {
    activeDownloads.delete(
      key
    );

    try {
      fs.rmSync(
        directory,
        {
          recursive:
            true,
          force:
            true
        }
      );
    } catch {
      // ошибка удаления временной папки не критична
    }
  }
}

// bot setup
function botKeyFromToken(
  token
) {
  return token.slice(
    0,
    12
  );
}

async function launchBot(
  token,
  index
) {
  const bot =
    new Telegraf(
      token
    );

  const botKey =
    botKeyFromToken(
      token
    );

  // middleware
  bot.use(
    async (
      ctx,
      next
    ) => {
      ctx.state.botKey =
        botKey;

      if (ctx.from) {
        getUser(
          botKey,
          ctx.from.id
        );
      }

      if (
        ctx.chat &&
        ctx.chat.type !==
          "private"
      ) {
        if (
          ctx.callbackQuery
        ) {
          await safeAnswer(
            ctx,
            "Бот работает только в личном чате"
          );
        }

        return;
      }

      return next();
    }
  );

  // start
  bot.start(
    async (ctx) => {
      try {
        clearUserState(
          botKey,
          ctx.from.id
        );

        const user =
          getUser(
            botKey,
            ctx.from.id
          );

        await ctx.reply(
          "👋 <b>Добро пожаловать</b>\n\n" +
            "📥 Это личный загрузчик видео и материалов\n\n" +
            "🌐 Доступно множество популярных площадок\n\n" +
            "🚀 Нажми <b>«⬇️ Скачать видео»</b>, чтобы начать",

          {
            parse_mode:
              "HTML",

            reply_markup:
              buildReplyKeyboard(
                user.keyboardEnabled
              )
          }
        );
      } catch (error) {
        logError(
          "start",
          error
        );
      }
    }
  );

  // keyboard command
  bot.command(
    "keyboard",

    async (ctx) => {
      try {
        const user =
          getUser(
            botKey,
            ctx.from.id
          );

        const enabled =
          !user.keyboardEnabled;

        updateUser(
          botKey,
          ctx.from.id,
          {
            keyboardEnabled:
              enabled
          }
        );

        clearUserState(
          botKey,
          ctx.from.id
        );

        await ctx.reply(
          enabled
            ? "🔔 <b>Reply-клавиатура включена</b>\n\n🎛️ Кнопки снова доступны"
            : "🔕 <b>Reply-клавиатура выключена</b>\n\n⌨️ Для включения снова используй <code>/keyboard</code>",

          {
            parse_mode:
              "HTML",

            reply_markup:
              buildReplyKeyboard(
                enabled
              )
          }
        );
      } catch (error) {
        logError(
          "keyboard",
          error
        );
      }
    }
  );

  // menu
  bot.command(
    "menu",

    async (ctx) => {
      try {
        clearUserState(
          botKey,
          ctx.from.id
        );

        await showHome(
          ctx
        );
      } catch (error) {
        logError(
          "menu",
          error
        );
      }
    }
  );

  // cancel
  bot.command(
    "cancel",

    async (ctx) => {
      try {
        clearUserState(
          botKey,
          ctx.from.id
        );

        await replyHtml(
          ctx,

          "🔄 <b>Действие сброшено</b>\n\n🏠 Можешь начать заново"
        );
      } catch (error) {
        logError(
          "cancel",
          error
        );
      }
    }
  );

  // reply download
  bot.hears(
    "⬇️ Скачать видео",

    async (ctx) => {
      try {
        clearUserState(
          botKey,
          ctx.from.id
        );

        await showPlatforms(
          ctx
        );
      } catch (error) {
        logError(
          "reply-download",
          error
        );
      }
    }
  );

  // reply settings
  bot.hears(
    "⚙️ Настройки",

    async (ctx) => {
      try {
        clearUserState(
          botKey,
          ctx.from.id
        );

        await showSettings(
          ctx
        );
      } catch (error) {
        logError(
          "reply-settings",
          error
        );
      }
    }
  );

  // reply help
  bot.hears(
    "❓ Помощь",

    async (ctx) => {
      try {
        clearUserState(
          botKey,
          ctx.from.id
        );

        await showHelp(
          ctx
        );
      } catch (error) {
        logError(
          "reply-help",
          error
        );
      }
    }
  );

  // reply reset
  bot.hears(
    "🔄 Сбросить действие",

    async (ctx) => {
      try {
        clearUserState(
          botKey,
          ctx.from.id
        );

        await replyHtml(
          ctx,

          "🔄 <b>Состояние сброшено</b>\n\n🏠 Можно начать заново"
        );
      } catch (error) {
        logError(
          "reply-reset",
          error
        );
      }
    }
  );

  // home navigation
  bot.action(
    "nav:home",

    async (ctx) => {
      try {
        await safeAnswer(
          ctx
        );

        clearUserState(
          botKey,
          ctx.from.id
        );

        await showHome(
          ctx
        );
      } catch (error) {
        logError(
          "nav-home",
          error
        );
      }
    }
  );

  // download navigation
  bot.action(
    "nav:download",

    async (ctx) => {
      try {
        await safeAnswer(
          ctx
        );

        clearUserState(
          botKey,
          ctx.from.id
        );

        await showPlatforms(
          ctx
        );
      } catch (error) {
        logError(
          "nav-download",
          error
        );
      }
    }
  );

  // platform navigation
  bot.action(
    "nav:platforms",

    async (ctx) => {
      try {
        await safeAnswer(
          ctx
        );

        clearUserState(
          botKey,
          ctx.from.id
        );

        await showPlatforms(
          ctx
        );
      } catch (error) {
        logError(
          "nav-platforms",
          error
        );
      }
    }
  );

  // settings navigation
  bot.action(
    "nav:settings",

    async (ctx) => {
      try {
        await safeAnswer(
          ctx
        );

        await showSettings(
          ctx,
          true
        );
      } catch (error) {
        logError(
          "nav-settings",
          error
        );
      }
    }
  );

  // help navigation
  bot.action(
    "nav:help",

    async (ctx) => {
      try {
        await safeAnswer(
          ctx
        );

        await showHelp(
          ctx,
          true
        );
      } catch (error) {
        logError(
          "nav-help",
          error
        );
      }
    }
  );

  // keyboard toggle
  bot.action(
    "settings:toggle",

    async (ctx) => {
      try {
        const user =
          getUser(
            botKey,
            ctx.from.id
          );

        const enabled =
          !user.keyboardEnabled;

        updateUser(
          botKey,
          ctx.from.id,
          {
            keyboardEnabled:
              enabled
          }
        );

        await safeAnswer(
          ctx,

          enabled
            ? "Клавиатура включена"
            : "Клавиатура выключена"
        );

        await showSettings(
          ctx,
          true
        );
      } catch (error) {
        logError(
          "settings-toggle",
          error
        );
      }
    }
  );

  // platform selection
  bot.action(
    /^platform:(.+)$/i,

    async (ctx) => {
      try {
        const platformId =
          String(
            ctx.match?.[1] ||
              ""
          ).trim();

        await safeAnswer(
          ctx
        );

        await askUrl(
          ctx,
          platformId
        );
      } catch (error) {
        logError(
          "platform",
          error
        );
      }
    }
  );

  // quality selection
  bot.action(
    /^quality:(144|360|480|720|1080|best)$/i,

    async (ctx) => {
      try {
        await startDownload(
          ctx,
          String(
            ctx.match[1]
          )
        );
      } catch (error) {
        logError(
          "quality",
          error
        );
      }
    }
  );

  // text handler
  bot.on(
    "text",

    async (ctx) => {
      try {
        const text =
          String(
            ctx.message?.text ||
              ""
          ).trim();

        if (
          !text ||
          text.startsWith(
            "/"
          )
        ) {
          return;
        }

        const state =
          getUserState(
            botKey,
            ctx.from.id
          );

        if (
          state?.waitingForUrl
        ) {
          await handleUrl(
            ctx,
            text
          );

          return;
        }

        await replyHtml(
          ctx,

          "💡 <b>Выбери действие</b>\n\n📥 Нажми <b>«⬇️ Скачать видео»</b> или используй <code>/start</code>"
        );
      } catch (error) {
        logError(
          "text",
          error
        );
      }
    }
  );

  // global bot error
  bot.catch(
    (
      error,
      ctx
    ) => {
      logError(
        `bot-${
          ctx?.updateType ||
          "update"
        }`,
        error
      );
    }
  );

  await bot.telegram.getMe();

  console.log(
    `✅ Бот #${index} подключён`
  );

  await bot.launch(
    {
      dropPendingUpdates:
        true
    }
  );
}

// start bots
async function main() {
  const bots =
    BOT_TOKENS.map(
      (
        token,
        index
      ) =>
        launchBot(
          token,
          index + 1
        ).catch(
          (error) => {
            logError(
              `bot-${index + 1}`,
              error
            );
          }
        )
    );

  await Promise.all(
    bots
  );

  console.log(
    `✅ Запущено ботов: ${BOT_TOKENS.length}`
  );
}

main().catch(
  (error) => {
    logError(
      "main",
      error
    );

    process.exitCode =
      1;
  }
);

// shutdown
function shutdown(
  signal
) {
  console.log(
    `🛑 ${signal}: завершение`
  );

  forceSave();

  process.exit(0);
}

process.once(
  "SIGINT",
  () =>
    shutdown(
      "SIGINT"
    )
);

process.once(
  "SIGTERM",
  () =>
    shutdown(
      "SIGTERM"
    )
);

process.on(
  "unhandledRejection",
  (error) => {
    logError(
      "unhandledRejection",
      error
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    logError(
      "uncaughtException",
      error
    );
  }
);
