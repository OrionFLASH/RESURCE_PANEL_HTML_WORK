/**
 * Чтение CSV/текста с автоопределением кодировки.
 * Типичный кейс: выгрузка из Excel/1С в windows-1251 — UTF-8 даёт «кракозябры» в заголовках.
 */
(function (global) {
  "use strict";

  /** Порядок перебора: BOM/UTF-8 сначала, затем типичные для RU Windows. */
  const CANDIDATE_ENCODINGS = [
    "utf-8",
    "windows-1251",
    "windows-1252",
    "iso-8859-5",
    "koi8-r",
    "x-mac-cyrillic"
  ];

  /**
   * @param {ArrayBuffer} buffer
   * @param {string} encoding
   * @returns {string|null}
   */
  function decodeBuffer(buffer, encoding) {
    try {
      const dec = new TextDecoder(encoding, { fatal: encoding === "utf-8" });
      return dec.decode(buffer);
    } catch (_err) {
      try {
        const dec = new TextDecoder(encoding, { fatal: false });
        return dec.decode(buffer);
      } catch (_err2) {
        return null;
      }
    }
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  function firstLine(text) {
    const s = String(text || "").replace(/^\uFEFF/, "");
    const m = /^[^\r\n]*/.exec(s);
    return m ? m[0] : "";
  }

  /**
   * Нормализация имени колонки для сравнения с алиасами.
   * @param {string} name
   * @returns {string}
   */
  function normHeader(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/["']/g, "")
      .replace(/\s+/g, " ");
  }

  /**
   * Оценка: насколько декод похож на валидную таблицу с нужными заголовками.
   * @param {string} text
   * @param {{ requiredAliases?: string[][], hintAliases?: string[] }} [opts]
   * @returns {number}
   */
  function scoreDecodedText(text, opts) {
    if (!text || !String(text).trim()) return -1e9;
    const raw = String(text);
    let score = 0;

    // Символ замены → явная порча
    const repl = (raw.match(/\uFFFD/g) || []).length;
    score -= repl * 80;

    const head = firstLine(raw);
    if (!head.trim()) score -= 200;

    // Кириллица в заголовке — сильный плюс для RU CSV
    const cyr = (head.match(/[А-Яа-яЁё]/g) || []).length;
    score += Math.min(40, cyr) * 3;

    // Кракозябры типичные для UTF-8, прочитанного как Latin-1/1252
    if (/[ÃÂÐÑ]/.test(head) && cyr < 2) score -= 60;

    // Разделитель
    const semi = (head.match(/;/g) || []).length;
    const comma = (head.match(/,/g) || []).length;
    const tab = (head.match(/\t/g) || []).length;
    const sepScore = Math.max(semi, comma, tab);
    score += Math.min(15, sepScore) * 2;

    const cells = head.split(/[;\t,]/).map(normHeader).filter(Boolean);

    const requiredGroups = (opts && opts.requiredAliases) || [];
    let matchedRequired = 0;
    for (let g = 0; g < requiredGroups.length; g += 1) {
      const aliases = requiredGroups[g] || [];
      let hit = false;
      for (let ai = 0; ai < aliases.length; ai += 1) {
        const a = normHeader(aliases[ai]);
        if (!a) continue;
        if (cells.some((c) => c === a || c.includes(a))) {
          hit = true;
          break;
        }
      }
      if (hit) {
        matchedRequired += 1;
        score += 120;
      } else {
        score -= 40;
      }
    }

    const hints = (opts && opts.hintAliases) || [];
    for (let i = 0; i < hints.length; i += 1) {
      const a = normHeader(hints[i]);
      if (!a) continue;
      if (cells.some((c) => c === a || c.includes(a))) score += 25;
    }

    // Бонус, если все обязательные группы найдены
    if (requiredGroups.length && matchedRequired === requiredGroups.length) score += 80;

    // Длина первой строки разумная
    if (head.length > 8 && head.length < 2000) score += 5;

    return score;
  }

  /**
   * Выбрать лучшую кодировку для буфера.
   * @param {ArrayBuffer} buffer
   * @param {{ requiredAliases?: string[][], hintAliases?: string[] }} [opts]
   * @returns {{ text: string, encoding: string, score: number, tried: { encoding: string, score: number }[] }}
   */
  function detectAndDecode(buffer, opts) {
    const bytes = new Uint8Array(buffer);
    /** @type {{ encoding: string, score: number }[]} */
    const tried = [];
    let best = { text: "", encoding: "utf-8", score: -1e12 };

    // UTF-8 BOM
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      const text = decodeBuffer(buffer, "utf-8");
      if (text != null) {
        return {
          text,
          encoding: "utf-8 (BOM)",
          score: scoreDecodedText(text, opts) + 200,
          tried: [{ encoding: "utf-8 (BOM)", score: scoreDecodedText(text, opts) + 200 }]
        };
      }
    }

    // UTF-16 LE/BE BOM
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      const text = decodeBuffer(buffer, "utf-16le");
      if (text != null) {
        const sc = scoreDecodedText(text, opts) + 150;
        return { text, encoding: "utf-16le (BOM)", score: sc, tried: [{ encoding: "utf-16le (BOM)", score: sc }] };
      }
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      const text = decodeBuffer(buffer, "utf-16be");
      if (text != null) {
        const sc = scoreDecodedText(text, opts) + 150;
        return { text, encoding: "utf-16be (BOM)", score: sc, tried: [{ encoding: "utf-16be (BOM)", score: sc }] };
      }
    }

    for (let i = 0; i < CANDIDATE_ENCODINGS.length; i += 1) {
      const enc = CANDIDATE_ENCODINGS[i];
      const text = decodeBuffer(buffer, enc);
      if (text == null) {
        tried.push({ encoding: enc, score: -1e9 });
        continue;
      }
      const sc = scoreDecodedText(text, opts);
      tried.push({ encoding: enc, score: sc });
      if (sc > best.score) {
        best = { text, encoding: enc, score: sc };
      }
    }

    if (!best.text) {
      const fallback = decodeBuffer(buffer, "utf-8") || "";
      return { text: fallback, encoding: "utf-8", score: -1, tried };
    }
    return { text: best.text, encoding: best.encoding, score: best.score, tried };
  }

  /**
   * Прочитать File/Blob как текст с автодетектом кодировки.
   * @param {Blob} file
   * @param {{ requiredAliases?: string[][], hintAliases?: string[] }} [opts]
   * @returns {Promise<{ text: string, encoding: string, score: number, byteLength: number }>}
   */
  function readFileDecoded(file, opts) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error("Файл не выбран."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const buffer = reader.result;
          if (!(buffer instanceof ArrayBuffer)) {
            reject(new Error("Не удалось прочитать файл как бинарные данные."));
            return;
          }
          const detected = detectAndDecode(buffer, opts || {});
          resolve({
            text: detected.text,
            encoding: detected.encoding,
            score: detected.score,
            byteLength: buffer.byteLength
          });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
      reader.readAsArrayBuffer(file);
    });
  }

  global.CsvEncoding = {
    CANDIDATE_ENCODINGS: CANDIDATE_ENCODINGS.slice(),
    decodeBuffer,
    scoreDecodedText,
    detectAndDecode,
    readFileDecoded
  };
})(typeof window !== "undefined" ? window : globalThis);
