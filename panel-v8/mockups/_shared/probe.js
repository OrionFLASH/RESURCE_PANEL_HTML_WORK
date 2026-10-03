/* Проверка доступности ссылок (работает из file://, без сервера).
   Метод: fetch(url, {mode:"no-cors"}) — ответ «непрозрачный», но сам факт ответа = хост доступен;
   ошибка сети / DNS / TLS / таймаут = недоступен. Содержимое ответа не читается.
     RPProbe.run(links, { onStart(id), onResult(id, res), onProgress(done, total), onDone(summary) })
       res = { st: "up" | "down", ms: число, at: Date, err?: "timeout" | "network" }
     RPProbe.every(ms, fn) — повтор по интервалу (по умолчанию 2 мин), возвращает функцию остановки. */
(function (root) {
  "use strict";
  var TIMEOUT = 6000;   // мс на один хост
  var PARALLEL = 6;     // не больше N запросов одновременно
  var running = null;

  function now() { return (root.performance && performance.now) ? performance.now() : Date.now(); }

  function probeOne(url) {
    var t0 = now();
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer;
    var timeout = new Promise(function (resolve) {
      timer = setTimeout(function () { if (ctrl) ctrl.abort(); resolve({ st: "down", err: "timeout" }); }, TIMEOUT);
    });
    // кэш-бастер, чтобы браузер не отвечал из кэша
    var u = url + (url.indexOf("?") < 0 ? "?" : "&") + "_rp=" + Date.now();
    var req = fetch(u, { mode: "no-cors", cache: "no-store", credentials: "omit", redirect: "follow", signal: ctrl ? ctrl.signal : undefined })
      .then(function () { return { st: "up" }; }, function () { return { st: "down", err: "network" }; });
    return Promise.race([req, timeout]).then(function (r) {
      clearTimeout(timer);
      r.ms = Math.round(now() - t0);
      r.at = new Date();
      return r;
    });
  }

  function run(links, h) {
    h = h || {};
    var list = (links || []).filter(function (l) { return l && l.u && /^https?:/i.test(l.u); });
    var token = {};
    running = token;
    var i = 0, done = 0, up = 0, total = list.length;
    list.forEach(function (l) { if (h.onStart) h.onStart(l.id); });
    if (h.onProgress) h.onProgress(0, total);
    return new Promise(function (resolve) {
      if (!total) { finish(); return; }
      function next() {
        if (running !== token) return;           // запущена новая проверка — эта больше не пишет
        if (i >= total) return;
        var l = list[i++];
        probeOne(l.u).then(function (res) {
          if (running !== token) return;
          done++; if (res.st === "up") up++;
          if (h.onResult) h.onResult(l.id, res);
          if (h.onProgress) h.onProgress(done, total);
          if (done === total) finish(); else next();
        });
      }
      function finish() {
        var s = { total: total, up: up, down: total - up, at: new Date() };
        if (h.onDone) h.onDone(s);
        resolve(s);
      }
      for (var k = 0; k < Math.min(PARALLEL, total); k++) next();
    });
  }

  function every(ms, fn) {
    var id = setInterval(fn, ms || 120000);
    return function () { clearInterval(id); };
  }

  root.RPProbe = { run: run, every: every, probeOne: probeOne, TIMEOUT: TIMEOUT, PARALLEL: PARALLEL };
})(window);
