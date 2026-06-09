// =============================================================================
// СКРИПТ ЗАГРУЗКИ ПРОФИЛЕЙ ГЕРОЕВ — ВАРИАНТ С ЗАГРУЗКОЙ ТН ИЗ ФАЙЛА
// =============================================================================
// Табельные можно загрузить из файла или взять из массива TAB_NUMS в коде.
// При запуске появляется выбор: «Выбрать файл .txt» или «Запустить по массиву из скрипта».
// В файле — любые разделители; нормализация: 8–20 цифр на номер.
// =============================================================================
// Весь код в IIFE: повторная вставка скрипта в консоль без перезагрузки и без SyntaxError на const.
(function () {
  "use strict";

// =============================================================================
// КОНФИГУРАЦИЯ
// =============================================================================
// Массив ТН для режима «без файла» (запуск по кнопке «По массиву из скрипта»).
const TAB_NUMS = [
 "00673892",
  "01515739",
  "01980754"
];

// Значения по умолчанию для панели и для вызова runCollectProfiles без второго аргумента.
const DEFAULT_REQUEST_DELAY_MS = 2;
const DEFAULT_ENABLE_RETRY = true;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_ON_ERROR_MS = 1500;
const DEFAULT_OUTPUT_BASE_NAME = "profiles";
const DEFAULT_BATCH_SIZE = 12000;
const DEFAULT_ENABLE_PHOTO_DOWNLOAD = false;
const DEFAULT_ENABLE_PHOTO_STRIP = true;

const PROFILE_ORIGINS = {
  PROM: {
    ALPHA: "https://efs-our-business-prom.omega.sbrf.ru",
    SIGMA: "https://salesheroes.sberbank.ru"
  },
  PSI: {
    ALPHA: "https://iam-enigma-psi.omega.sbrf.ru",
    SIGMA: "https://salesheroes-psi.sigma.sbrf.ru"
  },
  "IFT-SB": {
    ALPHA: "https://iam-enigma-psi.omega.sbrf.ru",
    SIGMA: "https://salesheroes-psi.sigma.sbrf.ru"
  },
  "IFT-GF": {
    ALPHA: "https://iam-enigma-psi.omega.sbrf.ru",
    SIGMA: "https://salesheroes-psi.sigma.sbrf.ru"
  }
};
const PROFILE_STAND_KEYS = ["PROM", "PSI", "IFT-SB", "IFT-GF"];
const PROFILE_CONTOUR_KEYS = ["ALPHA", "SIGMA"];
const PROFILE_PATH = "/bo/rmkib.gamification/proxy/v1/profile";
const PROFILE_AUTO_ENV = detectProfileEnvFromLocation();
const DEFAULT_PROFILE_STAND = (PROFILE_AUTO_ENV && PROFILE_AUTO_ENV.stand) || "PROM";
const DEFAULT_PROFILE_CONTOUR = (PROFILE_AUTO_ENV && PROFILE_AUTO_ENV.contour) || "SIGMA";

/**
 * Снимок параметров одного прогона (задаются на панели или в коде).
 * @returns {object}
 */
function getDefaultRunOptions() {
  return {
    requestDelayMs: DEFAULT_REQUEST_DELAY_MS,
    enableRetry: DEFAULT_ENABLE_RETRY,
    maxRetries: DEFAULT_MAX_RETRIES,
    retryDelayOnErrorMs: DEFAULT_RETRY_DELAY_ON_ERROR_MS,
    outputBaseName: DEFAULT_OUTPUT_BASE_NAME,
    batchSize: DEFAULT_BATCH_SIZE,
    enablePhotoDownload: DEFAULT_ENABLE_PHOTO_DOWNLOAD,
    enablePhotoStrip: DEFAULT_ENABLE_PHOTO_STRIP,
    /** DOM-узел панели: сюда добавляются ссылки «Скачать фото» (обход блокировки автоскачивания). */
    photoDownloadLinkHost: null
  };
}

/**
 * Нормализация опций после слияния с формой.
 * @param {object} raw
 * @returns {object}
 */
function normalizeRunOptions(raw) {
  const o = Object.assign(getDefaultRunOptions(), raw || {});
  o.requestDelayMs = Math.max(0, Number(o.requestDelayMs) || 0);
  o.maxRetries = Math.max(0, Math.floor(Number(o.maxRetries) || 0));
  o.retryDelayOnErrorMs = Math.max(0, Number(o.retryDelayOnErrorMs) || 0);
  o.batchSize = Math.max(1, Math.floor(Number(o.batchSize) || 1));
  var base = String(o.outputBaseName || "profiles").replace(/[/\\?%*:|"<>]/g, "_").trim();
  if (!base) base = "profiles";
  if (base.length > 80) base = base.slice(0, 80);
  o.outputBaseName = base;
  o.enableRetry = Boolean(o.enableRetry);
  o.enablePhotoDownload = Boolean(o.enablePhotoDownload);
  o.enablePhotoStrip = Boolean(o.enablePhotoStrip);
  return o;
}


function detectProfileEnvFromLocation() {
  var origin = "";
  try {
    origin = String(window.location.origin || "").toLowerCase();
  } catch (e) {}
  for (var si = 0; si < PROFILE_STAND_KEYS.length; si++) {
    var stand = PROFILE_STAND_KEYS[si];
    var byStand = PROFILE_ORIGINS[stand];
    if (!byStand) continue;
    for (var ci = 0; ci < PROFILE_CONTOUR_KEYS.length; ci++) {
      var contour = PROFILE_CONTOUR_KEYS[ci];
      var host = String((byStand && byStand[contour]) || "").toLowerCase();
      if (host && host === origin) {
        return { stand: stand, contour: contour };
      }
    }
  }
  return null;
}

/** Стенд/контур для URL профиля; меняются выпадающими списками на панели. */
let PROFILE_UI_STAND = DEFAULT_PROFILE_STAND;
let PROFILE_UI_CONTOUR = DEFAULT_PROFILE_CONTOUR;

function getProfileEnv() {
  var stand = PROFILE_STAND_KEYS.indexOf(PROFILE_UI_STAND) >= 0 ? PROFILE_UI_STAND : DEFAULT_PROFILE_STAND;
  var contour =
    PROFILE_CONTOUR_KEYS.indexOf(PROFILE_UI_CONTOUR) >= 0
      ? PROFILE_UI_CONTOUR
      : DEFAULT_PROFILE_CONTOUR;
  var byStand = PROFILE_ORIGINS[stand] || PROFILE_ORIGINS[DEFAULT_PROFILE_STAND];
  var origin = (byStand && byStand[contour]) || PROFILE_ORIGINS[DEFAULT_PROFILE_STAND][DEFAULT_PROFILE_CONTOUR];
  return { stand: stand, contour: contour, origin: origin };
}

/** Приёмник строк лога панели «Профили героев»; null после «Закрыть» или снятия панели. */
var profileGpPanelLogAppend = null;

/**
 * Записывает сообщение в «Журнал работы» на панели (аргументы склеиваются через пробел).
 * Уровень error дополнительно выводится в console.error.
 * @param {"log"|"warn"|"error"} level
 */
function profileGpPanelEcho(level) {
  var parts = [];
  for (var pi = 1; pi < arguments.length; pi++) {
    parts.push(String(arguments[pi]));
  }
  var s = parts.join(" ");
  if (level === "error") console.error(s);
  if (typeof profileGpPanelLogAppend === "function") {
    try {
      profileGpPanelLogAppend(s);
    } catch (eLog) {}
  }
}

// =============================================================================
// ПАРСИНГ ТАБЕЛЬНЫХ ИЗ ТЕКСТА (любые разделители, нормализация 8–20 цифр)
// =============================================================================

/**
 * Извлекает табельные номера из произвольного текста.
 * Разделители: любыые (запятая, точка с запятой, пробел, перенос строки и т.д.).
 * Табельный = подряд идущие цифры; не цифра = разделитель до следующей цифры.
 * Нормализация:
 *   — меньше 8 цифр → дополнение нулями слева до 8;
 *   — от 8 до 20 цифр → без изменений;
 *   — больше 20 цифр → берутся последние 20 цифр (обрезание «в начале»).
 * @param {string} text — содержимое файла или строка с числами.
 * @returns {string[]} массив строк (каждая 8–20 цифр).
 */
function parseTabNumbersFromText(text) {
  if (!text || typeof text !== "string") return [];
  const digitSequences = text.match(/\d+/g) || [];
  const result = [];
  for (const s of digitSequences) {
    let tn = s;
    if (tn.length < 8) tn = tn.padStart(8, "0");
    else if (tn.length > 20) tn = tn.slice(-20);
    result.push(tn);
  }
  return result;
}

/**
 * Формирует тело POST-запроса для получения профиля по табельному номеру.
 */
function makeRequestBody(tn) {
  return { employeeNumber: tn };
}

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function getTimestamp() {
  const d = new Date();
  const yyyy = d.getFullYear().toString();
  const MM = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return yyyy + MM + dd + "_" + hh + mm + ss;
}

function getJsonSizeBytes(obj) {
  const json = JSON.stringify(obj);
  return new TextEncoder().encode(json).length;
}

/**
 * Декодирует base64 в бинарную строку для atob: убирает пробелы, добавляет padding, при ошибке пробует URL-safe (- _).
 * @param {string} s — фрагмент после снятия префикса data:...;base64,
 * @returns {string}
 */
function decodeBase64ToBinaryString(s) {
  s = s.replace(/\s/g, "");
  if (!s.length) return "";
  function tryDecode(str) {
    var pad = str.length % 4;
    if (pad) str += "====".slice(pad);
    return atob(str);
  }
  try {
    return tryDecode(s);
  } catch (e1) {
    var urlSafe = s.replace(/-/g, "+").replace(/_/g, "/");
    return tryDecode(urlSafe);
  }
}

/**
 * Видимая ссылка на blob: скачивание по клику пользователя (не блокируется как «не жест» после await fetch).
 * @param {HTMLElement|null} hostEl
 * @param {string} objectUrl
 * @param {string} filename
 */
function appendPhotoDownloadLink(hostEl, objectUrl, filename) {
  if (!hostEl || !objectUrl) return;
  var wrap = document.createElement("div");
  wrap.style.cssText = "margin:3px 0;line-height:1.45;";
  var a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename || "photo.jpg";
  a.setAttribute("data-blob-url", objectUrl);
  a.textContent = "Скачать " + (filename || "photo.jpg");
  a.style.cssText = "color:#2563eb;font-weight:600;text-decoration:underline;word-break:break-all;";
  wrap.appendChild(a);
  hostEl.appendChild(wrap);
}

/**
 * Сохраняет фото на диск. API часто отдаёт «голый» base64 без префикса data: — href с ним не работает.
 * Поддерживаются: data:image/...;base64,... и строка только из base64 (считаем image/jpeg).
 * После await fetch часть браузеров блокирует только программный click — тогда помогает ссылка в linkHost (ручной клик).
 * @param {string} rawOrDataUrl
 * @param {string} filename
 * @param {HTMLElement|null} [linkHost] — контейнер на панели для ссылки «Скачать …»
 */
function downloadBase64File(rawOrDataUrl, filename, linkHost) {
  if (!rawOrDataUrl || typeof rawOrDataUrl !== "string") return;
  var objectUrl = null;
  try {
    var s = rawOrDataUrl.trim();
    var mime = "image/jpeg";
    if (/^data:([^;]+);base64,/i.test(s)) {
      mime = RegExp.$1 || mime;
      s = s.replace(/^data:[^;]+;base64,/i, "");
    }
    if (!s.replace(/\s/g, "").length) return;
    var binary = decodeBase64ToBinaryString(s);
    var n = binary.length;
    var bytes = new Uint8Array(n);
    for (var i = 0; i < n; i++) bytes[i] = binary.charCodeAt(i);
    var blob = new Blob([bytes], { type: mime || "image/jpeg" });
    objectUrl = URL.createObjectURL(blob);
    if (linkHost) {
      appendPhotoDownloadLink(linkHost, objectUrl, filename || "photo.jpg");
    }
    var a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename || "photo.jpg";
    a.setAttribute("download", filename || "photo.jpg");
    // display:none ломает программное скачивание в части браузеров (WebKit).
    a.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;";
    document.body.appendChild(a);
    if (typeof a.click === "function") {
      a.click();
    } else {
      var ev = document.createEvent("MouseEvents");
      ev.initMouseEvent("click", true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
      a.dispatchEvent(ev);
    }
    // Если есть ссылки на панели — держим URL дольше, чтобы успели нажать вручную.
    var revokeMs = linkHost ? 600000 : 60000;
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    }, revokeMs);
  } catch (e) {
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (eRev) {}
    }
    profileGpPanelEcho("warn", "Скачивание фото не удалось:", filename, e);
  }
}

/**
 * Ищет объект с полями photoData / photoDataKpk (ответ SIGMA может класть их глубже, не в body напрямую).
 * @param {object} data — корень ответа API (обычно с полем body).
 * @returns {object|null}
 */
function findProfilePhotoContainer(data) {
  if (!data || typeof data !== "object") return null;
  var b = data.body;
  if (!b || typeof b !== "object") return null;
  function hasPhotoStr(o) {
    return (
      (typeof o.photoData === "string" && o.photoData.length > 0) ||
      (typeof o.photoDataKpk === "string" && o.photoDataKpk.length > 0)
    );
  }
  if (hasPhotoStr(b)) return b;
  function walk(o, depth, maxDepth) {
    if (!o || typeof o !== "object" || depth > maxDepth) return null;
    if (hasPhotoStr(o)) return o;
    for (var k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
      var v = o[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        var r = walk(v, depth + 1, maxDepth);
        if (r) return r;
      }
    }
    return null;
  }
  return walk(b, 0, 10);
}

/**
 * Обработка полей фото в ответе профиля.
 * @param {string} tn
 * @param {object} data
 * @param {{ enablePhotoDownload: boolean, enablePhotoStrip: boolean }} cfg
 */
function processPhotos(tn, data, cfg) {
  if (!data || typeof data !== "object") return data;
  var body = data.body;
  if (!body || typeof body !== "object") return data;

  var photoHost = findProfilePhotoContainer(data);
  if (!photoHost) {
    if (cfg.enablePhotoDownload) {
      profileGpPanelEcho(
        "warn",
        "Фото: в ответе не найден объект с непустыми строками photoData / photoDataKpk (проверьте вложенность JSON)."
      );
    }
    return data;
  }

  let photoSize = 0;
  let photoKpkSize = 0;

  if (typeof photoHost.photoData === "string") {
    photoSize = photoHost.photoData.length;
    if (cfg.enablePhotoDownload && photoSize > 0) {
      var nameMain = tn + "_photoData.jpg";
      profileGpPanelEcho("log", "Скачивание фото:", nameMain, "| символов в строке:", photoSize);
      downloadBase64File(photoHost.photoData, nameMain, cfg.photoDownloadLinkHost || null);
    }
  }

  if (typeof photoHost.photoDataKpk === "string") {
    photoKpkSize = photoHost.photoDataKpk.length;
    if (cfg.enablePhotoDownload && photoKpkSize > 0) {
      var nameKpk = tn + "_photoDataKpk.jpg";
      profileGpPanelEcho("log", "Скачивание фото KPK:", nameKpk, "| символов:", photoKpkSize);
      downloadBase64File(photoHost.photoDataKpk, nameKpk, cfg.photoDownloadLinkHost || null);
    }
  }

  if (cfg.enablePhotoStrip) {
    delete photoHost.photoData;
    delete photoHost.photoDataKpk;
    photoHost.photoDataInfo = { hasData: photoSize > 0, length: photoSize };
    photoHost.photoDataKpkInfo = { hasData: photoKpkSize > 0, length: photoKpkSize };
  }

  return data;
}

/**
 * @param {string} tn
 * @param {object} cfg — нормализованные опции (normalizeRunOptions).
 */
async function fetchProfileByTN(tn, cfg) {
  const bodyObj = makeRequestBody(tn);
  const env = getProfileEnv();
  const standKey = env.stand;
  const contourKey = env.contour;
  const url = env.origin + PROFILE_PATH;

  const headers = {
    "Accept": "application/json",
    "Content-Type": "application/json"
  };
  if (contourKey === "SIGMA") {
    headers["Origin"] = env.origin;
    headers["Referer"] = env.origin + "/profile/" + tn;
  }

  const fetchOpts = {
    method: "POST",
    headers: headers,
    body: JSON.stringify(bodyObj),
    credentials: "include"
  };

  const res = await fetch(url, fetchOpts);

  if (!res.ok) {
    profileGpPanelEcho("warn", "TN", tn, "ERROR HTTP", res.status, "|", standKey + "/" + contourKey);
    return { tn: tn, error: true, status: res.status };
  }

  const rawData = await res.json();
  const sizeBefore = getJsonSizeBytes(rawData);
  const processed = processPhotos(tn, rawData, cfg);
  const sizeAfter = getJsonSizeBytes(processed);

  // Ответ с success: false (например «Запись не найдена») — выводим ERROR и поля ошибки; в JSON сохраняем как есть.
  if (rawData.success === false && rawData.error && typeof rawData.error === "object") {
    const err = rawData.error;
    profileGpPanelEcho(
      "log",
      "TN",
      tn,
      "| ERROR |",
      "code:",
      err.code || "",
      "system:",
      err.system || "",
      "text:",
      err.text || ""
    );
    return {
      tn: tn,
      error: true,
      requestBody: bodyObj,
      processed,
      sizeBefore: sizeBefore,
      sizeAfter: sizeAfter,
      code: err.code || "",
      system: err.system || "",
      text: err.text || ""
    };
  } else {
    profileGpPanelEcho(
      "log",
      "TN",
      tn,
      "| OK | size before:",
      sizeBefore,
      "bytes",
      "| size after:",
      sizeAfter,
      "bytes"
    );
  }

  return {
    tn: tn,
    requestBody: bodyObj,
    processed,
    sizeBefore: sizeBefore,
    sizeAfter: sizeAfter
  };
}

function saveJsonToFile(data, baseName, partIndex) {
  const jsonString = JSON.stringify(data);
  const sizeBytes = new TextEncoder().encode(jsonString).length;
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = getTimestamp();
  const part = partIndex != null ? "_part" + partIndex : "";
  const env = getProfileEnv();
  const filename = (baseName || "data") + "_" + env.stand + "_" + env.contour + part + "_" + ts + ".json";

  profileGpPanelEcho(
    "log",
    "Сохранение файла",
    filename,
    "| записей:",
    data.length,
    "| размер файла:",
    sizeBytes,
    "bytes"
  );

  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

// =============================================================================
// ОСНОВНАЯ ФУНКЦИЯ СБОРА (принимает массив ТН; при отсутствии — используется TAB_NUMS)
// =============================================================================

/**
 * Основной цикл сбора профилей по переданному массиву табельных номеров.
 * @param {string[]} tabNums — массив табельных (строки 8–20 цифр).
 * @param {object} [runOpts] — опции прогона; при отсутствии — getDefaultRunOptions().
 */
async function runCollectProfiles(tabNums, runOpts) {
  const cfg = normalizeRunOptions(runOpts);
  const list = tabNums && tabNums.length > 0 ? tabNums : [];
  if (list.length === 0) {
    profileGpPanelEcho(
      "warn",
      "Нет табельных номеров для обработки (файл пустой или не содержит чисел). Сбор не выполнен."
    );
    return;
  }

  console.log(
    "[Профили героев] Сбор запущен. ТН: " +
      list.length +
      ". Подробности — в «Журнал работы» на панели. Идёт обработка…"
  );

  // Освобождаем старые blob:URL со ссылок прошлого прогона (панель).
  if (cfg.photoDownloadLinkHost) {
    var oldLinks = cfg.photoDownloadLinkHost.querySelectorAll("a[data-blob-url]");
    for (var li = 0; li < oldLinks.length; li++) {
      try {
        URL.revokeObjectURL(oldLinks[li].getAttribute("data-blob-url") || "");
      } catch (eRevOld) {}
    }
    cfg.photoDownloadLinkHost.innerHTML = "";
  }

  let batch = [];
  let batchIndex = 1;
  let totalCount = 0;
  let totalOk = 0;
  let totalErr = 0;
  let totalSizeBefore = 0;
  let totalSizeAfter = 0;

  profileGpPanelEcho("log", "——— Старт сбора ———");
  profileGpPanelEcho("log", "Старт. Всего ТН к обработке:", list.length);
  var envRun = getProfileEnv();
  profileGpPanelEcho("log", "Стенд/контур:", envRun.stand + "/" + envRun.contour, "| URL:", envRun.origin + PROFILE_PATH);
  profileGpPanelEcho(
    "log",
    "Параметры | задержка мс:",
    cfg.requestDelayMs,
    "| retry:",
    cfg.enableRetry,
    "| maxRetries:",
    cfg.maxRetries,
    "| retryDelay мс:",
    cfg.retryDelayOnErrorMs,
    "| batch:",
    cfg.batchSize,
    "| имя файла:",
    cfg.outputBaseName,
    "| фото DL:",
    cfg.enablePhotoDownload,
    "| strip:",
    cfg.enablePhotoStrip
  );

  for (let i = 0; i < list.length; i++) {
    const tn = list[i];
    profileGpPanelEcho("log", "Запрос", i + 1, "/", list.length, "— ТН", tn);

    try {
      const retries = cfg.enableRetry ? cfg.maxRetries : 0;
      const maxAttempts = 1 + retries;
      let r = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          r = await fetchProfileByTN(tn, cfg);
        } catch (reqErr) {
          r = { tn: tn, error: true, exception: String(reqErr) };
        }

        // Успех — завершаем цикл попыток.
        if (!r.error) {
          if (attempt > 1) {
            profileGpPanelEcho("log", "TN", tn, "| OK после", attempt, "-й попытки");
          }
          break;
        }

        // Ошибка и попытки закончились — фиксируем как итоговую ошибку.
        if (attempt >= maxAttempts) {
          profileGpPanelEcho(
            "log",
            "TN",
            tn,
            "| ERROR после",
            attempt,
            "-й попытки | status:",
            r.status || "n/a"
          );
          break;
        }

        // Ошибка и есть ещё попытки — ждём и повторяем.
        profileGpPanelEcho(
          "warn",
          "TN",
          tn,
          "| Ошибка на",
          attempt,
          "-й попытке. Повтор через",
          cfg.retryDelayOnErrorMs,
          "мс"
        );
        if (cfg.retryDelayOnErrorMs > 0) {
          await delay(cfg.retryDelayOnErrorMs);
        }
      }

      if (r && r.error) {
        totalErr++;
      } else {
        totalOk++;
        totalSizeBefore += (r && r.sizeBefore) || 0;
        totalSizeAfter += (r && r.sizeAfter) || 0;
      }

      batch.push(r);
      totalCount++;
    } catch (e) {
      profileGpPanelEcho("error", "Исключение при запросе для", tn, e);
      batch.push({ tn: tn, error: true, exception: String(e) });
      totalErr++;
      totalCount++;
    }

    if (batch.length >= cfg.batchSize) {
      profileGpPanelEcho("log", "== Сохранение батча", batchIndex, "| записей:", batch.length, "==");
      saveJsonToFile(batch, cfg.outputBaseName, batchIndex);
      batch = [];
      batchIndex++;
    }

    if (i < list.length - 1 && cfg.requestDelayMs > 0) {
      await delay(cfg.requestDelayMs);
    }
  }

  if (batch.length > 0) {
    profileGpPanelEcho("log", "== Сохранение финального батча", batchIndex, "| записей:", batch.length, "==");
    saveJsonToFile(batch, cfg.outputBaseName, batchIndex);
  }

  profileGpPanelEcho("log", "==== ИТОГ ====");
  profileGpPanelEcho("log", "Всего ТН:", list.length);
  profileGpPanelEcho("log", "Всего обработано записей:", totalCount);
  profileGpPanelEcho("log", "Успешных:", totalOk, "| Ошибок:", totalErr);
  profileGpPanelEcho("log", "Суммарный размер ответов ДО обработки:", totalSizeBefore, "bytes");
  profileGpPanelEcho("log", "Суммарный размер ответов ПОСЛЕ обработки:", totalSizeAfter, "bytes");

  console.log(
    "[Профили героев] Сбор завершён. Всего ТН: " +
      list.length +
      " | успешно: " +
      totalOk +
      " | ошибок: " +
      totalErr +
      " | обработано записей: " +
      totalCount
  );
}

// =============================================================================
// ЗАГРУЗКА ТН ИЗ ФАЙЛА И ЗАПУСК СБОРА
// =============================================================================

/**
 * Панель: стенд, параметры прогона (задержки, retry, батч, фото), источник ТН и кнопки запуска.
 */
function startWithChoice() {
  var prev = document.getElementById("profileGpLoadPanelRoot");
  if (prev) {
    profileGpPanelLogAppend = null;
    prev.remove();
  }

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".txt,text/plain";
  input.style.display = "none";

  function readOptsFromForm() {
    return normalizeRunOptions({
      requestDelayMs: inReqDelay.value,
      enableRetry: cbRetry.checked,
      maxRetries: inMaxRetries.value,
      retryDelayOnErrorMs: inRetryDel.value,
      outputBaseName: inOutName.value,
      batchSize: inBatch.value,
      enablePhotoDownload: cbPhotoDl.checked,
      enablePhotoStrip: cbPhotoStrip.checked
    });
  }

  function syncRetryFields() {
    var on = cbRetry.checked;
    inMaxRetries.disabled = !on;
    inRetryDel.disabled = !on;
    inMaxRetries.style.opacity = on ? "1" : "0.45";
    inRetryDel.style.opacity = on ? "1" : "0.45";
  }

  const container = document.createElement("div");
  container.id = "profileGpLoadPanelRoot";
  container.style.cssText =
    "position:fixed;top:10px;right:10px;width:min(920px,calc(100vw - 20px));max-height:calc(100vh - 16px);overflow:auto;" +
    "z-index:999999;box-sizing:border-box;padding:12px 16px 12px;" +
    "background:#ffffff;border:1px solid #cbd5e1;border-radius:12px;" +
    "box-shadow:0 10px 40px rgba(15,23,42,.12);font-family:system-ui,-apple-system,sans-serif;" +
    "color:#0f172a;color-scheme:light;";

  const head = document.createElement("div");
  head.style.cssText = "font-size:16px;font-weight:700;color:#0f172a;margin:0 0 2px 0;letter-spacing:-0.02em;line-height:1.2;";
  head.textContent = "Профили героев";
  container.appendChild(head);

  const sub = document.createElement("div");
  sub.style.cssText = "font-size:11px;color:#64748b;margin:0 0 10px 0;line-height:1.35;";
  sub.textContent = "Сбор по API профиля: выберите стенд и контур, при необходимости параметры ниже, источник ТН.";
  container.appendChild(sub);

  const rowStand = document.createElement("div");
  rowStand.style.cssText =
    "display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;padding:8px 10px;" +
    "background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;";
  const labStand = document.createElement("label");
  labStand.textContent = "Стенд";
  labStand.setAttribute("for", "profileStandSel");
  labStand.style.cssText = "font-weight:600;font-size:12px;color:#334155;min-width:48px;flex-shrink:0;";
  const selStand = document.createElement("select");
  selStand.id = "profileStandSel";
  selStand.style.cssText =
    "flex:1;min-width:220px;padding:6px 10px;font-size:12px;cursor:pointer;" +
    "color:#0f172a;background:#fff;border:1px solid #94a3b8;border-radius:6px;color-scheme:light;";
  PROFILE_STAND_KEYS.forEach(function (key) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = key;
    opt.style.cssText = "color:#0f172a;background:#fff;";
    if (key === PROFILE_UI_STAND) opt.selected = true;
    selStand.appendChild(opt);
  });
  selStand.addEventListener("change", function () {
    PROFILE_UI_STAND = selStand.value;
  });
  rowStand.appendChild(labStand);
  rowStand.appendChild(selStand);

  const labContour = document.createElement("label");
  labContour.textContent = "Контур";
  labContour.setAttribute("for", "profileContourSel");
  labContour.style.cssText = "font-weight:600;font-size:12px;color:#334155;min-width:56px;flex-shrink:0;";
  const selContour = document.createElement("select");
  selContour.id = "profileContourSel";
  selContour.style.cssText =
    "flex:1;min-width:220px;padding:6px 10px;font-size:12px;cursor:pointer;" +
    "color:#0f172a;background:#fff;border:1px solid #94a3b8;border-radius:6px;color-scheme:light;";
  function refreshProfileContourOptions() {
    const prev = PROFILE_UI_CONTOUR;
    selContour.innerHTML = "";
    PROFILE_CONTOUR_KEYS.forEach(function (key) {
      const opt = document.createElement("option");
      const byStand = PROFILE_ORIGINS[PROFILE_UI_STAND] || PROFILE_ORIGINS[DEFAULT_PROFILE_STAND];
      opt.value = key;
      opt.textContent = key;
      opt.style.cssText = "color:#0f172a;background:#fff;";
      if (key === prev) opt.selected = true;
      selContour.appendChild(opt);
    });
  }
  refreshProfileContourOptions();
  selStand.addEventListener("change", function () {
    refreshProfileContourOptions();
  });
  selContour.addEventListener("change", function () {
    PROFILE_UI_CONTOUR = selContour.value;
  });
  rowStand.appendChild(labContour);
  rowStand.appendChild(selContour);

  const envInfo = document.createElement("div");
  envInfo.style.cssText =
    "margin-left:auto;font-size:11px;color:#64748b;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;";
  function refreshProfileEnvInfo() {
    try {
      envInfo.textContent = "POST " + getProfileEnv().origin;
    } catch (e) {
      envInfo.textContent = "";
    }
  }
  selStand.addEventListener("change", refreshProfileEnvInfo);
  selContour.addEventListener("change", refreshProfileEnvInfo);
  refreshProfileEnvInfo();
  rowStand.appendChild(envInfo);
  container.appendChild(rowStand);

  const def = getDefaultRunOptions();
  const details = document.createElement("details");
  details.open = true;
  details.style.cssText = "margin:0 0 10px 0;border:1px solid #e2e8f0;border-radius:8px;padding:0;overflow:hidden;";
  const summ = document.createElement("summary");
  summ.style.cssText =
    "cursor:pointer;list-style:none;padding:8px 10px;font-size:12px;font-weight:600;background:#f1f5f9;color:#334155;" +
    "user-select:none;";
  summ.textContent = "Параметры запуска (задержки, retry, батч, фото)";
  details.appendChild(summ);

  const paramsBody = document.createElement("div");
  paramsBody.style.cssText =
    "padding:5px 8px 7px;border-top:1px solid #e2e8f0;background:#fafafa;display:flex;flex-direction:column;gap:4px;";

  const lblEnd =
    "justify-self:end;text-align:right;padding:0 3px 0 0;color:#475569;font-size:10px;line-height:1.15;align-self:center;white-space:nowrap;";
  const inpN =
    "padding:2px 6px;box-sizing:border-box;border:1px solid #94a3b8;border-radius:4px;font-size:11px;height:22px;width:64px;max-width:100%;color:#0f172a;background:#fff;color-scheme:light;";
  const inpNW =
    "padding:2px 6px;box-sizing:border-box;border:1px solid #94a3b8;border-radius:4px;font-size:11px;height:22px;width:74px;max-width:100%;color:#0f172a;background:#fff;color-scheme:light;";

  // Одна линия: три числовых параметра задержек/retry и чекбокс «повтор».
  var rowDelays = document.createElement("div");
  rowDelays.style.cssText =
    "display:grid;grid-template-columns:" +
    "max-content minmax(56px,64px) max-content minmax(48px,56px) max-content minmax(64px,74px) minmax(140px,1fr);" +
    "gap:3px 6px;align-items:center;overflow-x:auto;padding-bottom:1px;";
  const tipReqDelay =
    "Пауза после каждого успешного запроса профиля, миллисекунды. Увеличьте при ограничениях API.";
  const tipMaxRet =
    "Сколько раз повторить запрос после ошибки (не считая первую попытку). Работает только если включён «Повтор при ошибке».";
  const tipRetryMs = "Пауза перед следующей попыткой после сбоя по табельному номеру, миллисекунды.";
  const tipRetryEn = "Если запрос по ТН вернул ошибку — повторить с задержкой (см. поля справа).";

  const l1 = document.createElement("label");
  l1.htmlFor = "profReqDelay";
  l1.textContent = "Пауза между запросами, мс";
  l1.title = tipReqDelay;
  l1.style.cssText = lblEnd;
  const inReqDelay = document.createElement("input");
  inReqDelay.type = "number";
  inReqDelay.id = "profReqDelay";
  inReqDelay.min = "0";
  inReqDelay.step = "1";
  inReqDelay.value = String(def.requestDelayMs);
  inReqDelay.title = tipReqDelay;
  inReqDelay.style.cssText = inpN;

  const l2 = document.createElement("label");
  l2.htmlFor = "profMaxRetr";
  l2.textContent = "Доп. попыток после первой";
  l2.title = tipMaxRet;
  l2.style.cssText = lblEnd;
  const inMaxRetries = document.createElement("input");
  inMaxRetries.type = "number";
  inMaxRetries.id = "profMaxRetr";
  inMaxRetries.min = "0";
  inMaxRetries.step = "1";
  inMaxRetries.value = String(def.maxRetries);
  inMaxRetries.title = tipMaxRet;
  inMaxRetries.style.cssText = inpN;

  const l3 = document.createElement("label");
  l3.htmlFor = "profRetryMs";
  l3.textContent = "Пауза перед повтором, мс";
  l3.title = tipRetryMs;
  l3.style.cssText = lblEnd;
  const inRetryDel = document.createElement("input");
  inRetryDel.type = "number";
  inRetryDel.id = "profRetryMs";
  inRetryDel.min = "0";
  inRetryDel.step = "100";
  inRetryDel.value = String(def.retryDelayOnErrorMs);
  inRetryDel.title = tipRetryMs;
  inRetryDel.style.cssText = inpNW;

  const cbRetry = document.createElement("input");
  cbRetry.type = "checkbox";
  cbRetry.id = "profRetryEn";
  cbRetry.checked = def.enableRetry;
  cbRetry.title = tipRetryEn;
  const lbRetry = document.createElement("label");
  lbRetry.htmlFor = "profRetryEn";
  lbRetry.title = tipRetryEn;
  lbRetry.style.cssText =
    "display:flex;align-items:center;gap:5px;margin:0;font-size:11px;color:#0f172a;cursor:pointer;font-weight:600;line-height:1.2;min-width:0;";
  lbRetry.appendChild(cbRetry);
  lbRetry.appendChild(document.createTextNode("Повтор при ошибке по ТН"));

  rowDelays.appendChild(l1);
  rowDelays.appendChild(inReqDelay);
  rowDelays.appendChild(l2);
  rowDelays.appendChild(inMaxRetries);
  rowDelays.appendChild(l3);
  rowDelays.appendChild(inRetryDel);
  rowDelays.appendChild(lbRetry);
  paramsBody.appendChild(rowDelays);

  var rowName = document.createElement("div");
  rowName.style.cssText = "display:grid;grid-template-columns:132px 1fr;gap:8px;align-items:center;margin-top:1px;";
  const tipOutName =
    "Префикс имён сохраняемых JSON-файлов (например, profiles → profiles_batch_1.json). Недопустимые символы заменяются.";
  const l4 = document.createElement("label");
  l4.htmlFor = "profOutName";
  l4.textContent = "Базовое имя JSON";
  l4.title = tipOutName;
  l4.style.cssText = lblEnd;
  const inOutName = document.createElement("input");
  inOutName.type = "text";
  inOutName.id = "profOutName";
  inOutName.value = def.outputBaseName;
  inOutName.title = tipOutName;
  inOutName.style.cssText =
    "padding:3px 8px;box-sizing:border-box;border:1px solid #94a3b8;border-radius:4px;font-size:11px;height:22px;" +
    "color:#0f172a;background:#fff;width:100%;min-width:0;color-scheme:light;";
  rowName.appendChild(l4);
  rowName.appendChild(inOutName);
  paramsBody.appendChild(rowName);

  var rowBatchPhoto = document.createElement("div");
  rowBatchPhoto.style.cssText =
    "display:grid;grid-template-columns:max-content minmax(72px,80px) 1fr;gap:5px 10px;align-items:center;margin-top:1px;";
  const tipBatch =
    "Сколько профилей пишется в один JSON перед сохранением следующего файла. Большие значения — крупнее файлы.";
  const l5 = document.createElement("label");
  l5.htmlFor = "profBatch";
  l5.textContent = "Записей в батче";
  l5.title = tipBatch;
  l5.style.cssText = lblEnd;
  const inBatch = document.createElement("input");
  inBatch.type = "number";
  inBatch.id = "profBatch";
  inBatch.min = "1";
  inBatch.step = "100";
  inBatch.value = String(def.batchSize);
  inBatch.title = tipBatch;
  inBatch.style.cssText = inpNW;
  const tipPhotoDl =
    "После ответа API дополнительно скачивать изображения (photoData/KPK). Ссылки на ручное скачивание — в зелёном блоке ниже.";
  const tipPhotoStrip =
    "Убрать длинные base64 из поля photoDataInfo в JSON — файлы легче; полное фото при необходимости — через отдельное скачивание.";
  const cellPhotoChecks = document.createElement("div");
  cellPhotoChecks.style.cssText =
    "display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;gap:6px 14px;min-width:0;";
  const cbPhotoDl = document.createElement("input");
  cbPhotoDl.type = "checkbox";
  cbPhotoDl.id = "profPhotoDl";
  cbPhotoDl.checked = def.enablePhotoDownload;
  cbPhotoDl.title = tipPhotoDl;
  const lbPhotoDl = document.createElement("label");
  lbPhotoDl.htmlFor = "profPhotoDl";
  lbPhotoDl.title = tipPhotoDl;
  lbPhotoDl.style.cssText =
    "display:flex;align-items:center;gap:5px;margin:0;font-size:11px;color:#0f172a;cursor:pointer;line-height:1.2;white-space:nowrap;max-width:100%;";
  lbPhotoDl.appendChild(cbPhotoDl);
  lbPhotoDl.appendChild(document.createTextNode("Скачивать фото (photoData / KPK) отдельно"));
  const cbPhotoStrip = document.createElement("input");
  cbPhotoStrip.type = "checkbox";
  cbPhotoStrip.id = "profPhotoStrip";
  cbPhotoStrip.checked = def.enablePhotoStrip;
  cbPhotoStrip.title = tipPhotoStrip;
  const lbPhotoStrip = document.createElement("label");
  lbPhotoStrip.htmlFor = "profPhotoStrip";
  lbPhotoStrip.title = tipPhotoStrip;
  lbPhotoStrip.style.cssText =
    "display:flex;align-items:center;gap:5px;margin:0;font-size:11px;color:#0f172a;cursor:pointer;line-height:1.2;white-space:nowrap;max-width:100%;";
  lbPhotoStrip.appendChild(cbPhotoStrip);
  lbPhotoStrip.appendChild(document.createTextNode("Урезать base64 в JSON (photoDataInfo)"));
  cellPhotoChecks.appendChild(lbPhotoDl);
  cellPhotoChecks.appendChild(lbPhotoStrip);
  rowBatchPhoto.appendChild(l5);
  rowBatchPhoto.appendChild(inBatch);
  rowBatchPhoto.appendChild(cellPhotoChecks);
  paramsBody.appendChild(rowBatchPhoto);

  // Контейнер для ручного скачивания фото: программный клик после await fetch часто не считается «жестом пользователя».
  const photoDlSection = document.createElement("div");
  photoDlSection.style.cssText =
    "margin:8px 0 0 0;padding:8px 8px 6px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;";
  const photoDlSectionTitle = document.createElement("div");
  photoDlSectionTitle.style.cssText =
    "font-size:10px;color:#166534;font-weight:600;margin:0 0 4px 0;line-height:1.3;";
  photoDlSectionTitle.textContent =
    "Ссылки на фото: если в папку загрузок ничего не пришло, нажмите здесь (браузер часто блокирует автоскачивание после запроса).";
  var photoDlLinkHost = document.createElement("div");
  photoDlLinkHost.id = "profileGpPhotoDlHost";
  photoDlLinkHost.style.cssText = "font-size:11px;";
  photoDlSection.appendChild(photoDlSectionTitle);
  photoDlSection.appendChild(photoDlLinkHost);
  paramsBody.appendChild(photoDlSection);

  /** Опции прогона + привязка панели со ссылками на фото. */
  function readRunOptsForCollect() {
    return Object.assign(readOptsFromForm(), { photoDownloadLinkHost: photoDlLinkHost });
  }

  cbRetry.addEventListener("change", syncRetryFields);
  syncRetryFields();

  details.appendChild(paramsBody);
  container.appendChild(details);

  const secTn = document.createElement("div");
  secTn.style.cssText =
    "font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;margin:10px 0 6px 0;";
  secTn.textContent = "Источник табельных";
  container.appendChild(secTn);

  const labTa = document.createElement("div");
  labTa.style.cssText = "font-size:11px;color:#475569;margin:0 0 6px 0;line-height:1.35;";
  labTa.textContent =
    "Текст или файл: любые разделители между числами; нормализация 8–20 цифр. Либо массив TAB_NUMS в скрипте.";
  container.appendChild(labTa);

  const taNums = document.createElement("textarea");
  taNums.rows = 3;
  taNums.style.cssText =
    "width:100%;box-sizing:border-box;margin:0 0 8px 0;padding:8px;font-size:12px;font-family:ui-monospace,monospace;" +
    "color:#0f172a;background:#fff;border:1px solid #94a3b8;border-radius:8px;resize:vertical;min-height:64px;max-height:140px;color-scheme:light;";
  taNums.placeholder = "Например:\n00673892, 01515739\n01980754";
  taNums.spellcheck = false;
  container.appendChild(taNums);

  const btnCssBase =
    "width:100%;box-sizing:border-box;padding:6px 8px;margin:0;font-size:11px;font-weight:600;line-height:1.25;" +
    "cursor:pointer;border-radius:6px;border:none;transition:opacity .15s;text-align:center;word-break:break-word;";
  const rowRunBtns = document.createElement("div");
  rowRunBtns.style.cssText =
    "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:0 0 8px 0;align-items:stretch;";

  const btnFromText = document.createElement("button");
  btnFromText.type = "button";
  btnFromText.textContent = "Запустить по тексту из поля";
  btnFromText.style.cssText = btnCssBase + "background:linear-gradient(180deg,#7c3aed,#6d28d9);color:#fff;box-shadow:0 2px 6px rgba(124,58,237,.35);";
  btnFromText.addEventListener("click", function () {
    const tabNums = parseTabNumbersFromText(taNums.value);
    if (tabNums.length === 0) {
      profileGpPanelEcho("warn", "В поле нет табельных номеров (нужны группы цифр).");
      return;
    }
    profileGpPanelEcho("log", "Запуск по тексту из поля, ТН:", tabNums.length);
    profileGpPanelEcho("log", "Сбор в фоне — панель не закрывается; по окончании смотрите «Журнал работы» ниже и загрузки.");
    runCollectProfiles(tabNums, readRunOptsForCollect());
  });

  const btnFile = document.createElement("button");
  btnFile.type = "button";
  btnFile.textContent = "Выбрать файл .txt и запустить";
  btnFile.style.cssText = btnCssBase + "background:#2563eb;color:#fff;box-shadow:0 2px 6px rgba(37,99,235,.3);";
  btnFile.addEventListener("click", function () {
    input.click();
  });

  const btnArray = document.createElement("button");
  btnArray.type = "button";
  btnArray.textContent = "Запустить по TAB_NUMS из скрипта";
  btnArray.style.cssText = btnCssBase + "background:#059669;color:#fff;box-shadow:0 2px 6px rgba(5,150,105,.3);";
  btnArray.addEventListener("click", function () {
    if (TAB_NUMS.length === 0) {
      profileGpPanelEcho("warn", "Массив TAB_NUMS в скрипте пуст.");
      return;
    }
    profileGpPanelEcho("log", "Запуск по TAB_NUMS, ТН:", TAB_NUMS.length);
    profileGpPanelEcho("log", "Сбор в фоне — панель не закрывается; по окончании смотрите «Журнал работы» ниже и загрузки.");
    runCollectProfiles(TAB_NUMS, readRunOptsForCollect());
  });

  rowRunBtns.appendChild(btnFromText);
  rowRunBtns.appendChild(btnFile);
  rowRunBtns.appendChild(btnArray);

  const logSecLab = document.createElement("div");
  logSecLab.textContent = "Журнал работы";
  logSecLab.style.cssText =
    "font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;margin:0 0 4px 0;";
  const logEl = document.createElement("pre");
  logEl.setAttribute("role", "log");
  logEl.setAttribute("aria-live", "polite");
  logEl.style.cssText =
    "margin:0 0 8px 0;padding:6px 8px;min-height:72px;max-height:min(200px,28vh);overflow:auto;box-sizing:border-box;" +
    "font-family:ui-monospace,monospace;font-size:10px;line-height:1.35;color:#0f172a;background:#f8fafc;" +
    "border:1px solid #e2e8f0;border-radius:6px;white-space:pre-wrap;word-break:break-word;";
  logEl.textContent = "";

  profileGpPanelLogAppend = function (line) {
    logEl.textContent += line + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  };

  const btnClose = document.createElement("button");
  btnClose.type = "button";
  btnClose.textContent = "Закрыть панель";
  btnClose.title = "Снять панель с экрана. Повторный запуск — снова вставить скрипт в консоль (страницу не перезагружать).";
  btnClose.style.cssText =
    "width:100%;box-sizing:border-box;margin-top:0;padding:6px 10px;font-size:11px;cursor:pointer;" +
    "background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;border-radius:8px;font-weight:500;";
  btnClose.addEventListener("click", function () {
    try {
      input.value = "";
    } catch (eCloseInp) {}
    profileGpPanelLogAppend = null;
    container.remove();
  });

  container.appendChild(rowRunBtns);
  container.appendChild(logSecLab);
  container.appendChild(logEl);
  container.appendChild(btnClose);
  container.appendChild(input);
  document.body.appendChild(container);
  console.log(
    "[Профили героев] Панель открыта. Подробный журнал — в окне «Журнал работы» на панели."
  );

  input.addEventListener("change", function () {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      const text = typeof reader.result === "string" ? reader.result : "";
      const tabNums = parseTabNumbersFromText(text);
      profileGpPanelEcho("log", "Из файла извлечено ТН:", tabNums.length);
      profileGpPanelEcho("log", "Сбор в фоне — панель не закрывается; по окончании смотрите «Журнал работы» ниже и загрузки.");
      runCollectProfiles(tabNums, readRunOptsForCollect());
      try {
        input.value = "";
      } catch (eClr) {}
    };
    reader.readAsText(file, "UTF-8");
  });
}

// При вставке скрипта в консоль — панель: текстовое поле ТН, файл или TAB_NUMS.
startWithChoice();
})();
