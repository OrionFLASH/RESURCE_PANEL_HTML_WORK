// =============================================================================
// UI_AutoTest.js — последовательный проход по пунктам меню (запуск в DevTools)
// =============================================================================
// Назначение:
// 1) Последовательно найти и нажать ссылки меню по списку href.
// 2) Выдержать паузу между кликами.
// 3) Вывести в консоль статус по каждому пункту: OK / НЕ OK.
// =============================================================================

(function () {
  /** Минимальная пауза между шагами (мс). */
  const STEP_DELAY_MS = 500;
  /** Максимальное ожидание загрузки после клика (мс). */
  const NAVIGATION_TIMEOUT_MS = 15000;
  /** Интервал опроса состояния страницы (мс). */
  const NAVIGATION_POLL_MS = 50;

  /** Последовательность href для прохода по основному и admin-меню. */
  const MENU_HREFS = [
    "/community",
    "/tournaments",
    "/awards",
    "/store",
    "/rating",
    "/about",
    "/admin/notifications",
    "/admin/community",
    "/admin/preferences",
    "/admin/orders",
    "/admin/seasons",
    "/admin/statistic",
    "/admin/parameters",
  ];

  /**
   * Неблокирующая пауза.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Пытается найти ссылку по href и кликнуть по ней.
   * @param {string} href
   * @returns {Promise<boolean>} true, если клик выполнен
   */
  async function clickMenuByHref(href) {
    const selector = 'a[href="' + href + '"]';
    const el = document.querySelector(selector);
    if (!el) {
      console.warn("[UI_AutoTest][НЕ OK] Не найден элемент:", href, "| селектор:", selector);
      return false;
    }
    console.log("[UI_AutoTest][OK] Клик по:", href, el);
    el.click();
    return true;
  }

  /**
   * Ждёт завершения перехода:
   * - если URL сменился, ждём document.readyState === "complete";
   * - если загрузка заняла меньше STEP_DELAY_MS, добираем паузу до минимума.
   * @param {string} prevUrl
   * @returns {Promise<{ changed: boolean; timedOut: boolean; elapsedMs: number }>}
   */
  async function waitForPageReadyAfterClick(prevUrl) {
    const startedAt = Date.now();
    let changed = false;
    let timedOut = false;

    while (Date.now() - startedAt < NAVIGATION_TIMEOUT_MS) {
      if (window.location.href !== prevUrl) {
        changed = true;
      }
      if (document.readyState === "complete" && changed) {
        break;
      }
      await delay(NAVIGATION_POLL_MS);
    }

    if (!changed) {
      // Для SPA переход может не менять href: в этом случае используем минимум паузы.
      if (document.readyState !== "complete") {
        timedOut = true;
      }
    } else if (document.readyState !== "complete") {
      timedOut = true;
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs < STEP_DELAY_MS) {
      await delay(STEP_DELAY_MS - elapsedMs);
    }
    return { changed, timedOut, elapsedMs: Date.now() - startedAt };
  }

  /**
   * Основной проход по всем пунктам.
   * Пауза выдерживается после каждого шага (кроме последнего).
   */
  async function runMenuWalk() {
    console.log("[UI_AutoTest] Старт прохода. Пунктов:", MENU_HREFS.length, "| пауза:", STEP_DELAY_MS, "мс");
    let okCount = 0;
    let failCount = 0;

    for (let i = 0; i < MENU_HREFS.length; i++) {
      const href = MENU_HREFS[i];
      const prevUrl = window.location.href;
      const ok = await clickMenuByHref(href);
      if (ok) {
        okCount++;
        const nav = await waitForPageReadyAfterClick(prevUrl);
        if (nav.timedOut) {
          console.warn(
            "[UI_AutoTest][WARN] Переход по",
            href,
            "не подтвердил полную загрузку за",
            NAVIGATION_TIMEOUT_MS,
            "мс. Продолжаем.",
          );
        } else {
          console.log(
            "[UI_AutoTest] Переход обработан:",
            href,
            "| href changed:",
            nav.changed,
            "| ожидание:",
            nav.elapsedMs,
            "мс",
          );
        }
      } else {
        failCount++;
        // Если пункт не найден, всё равно выдерживаем минимальную паузу для стабильного темпа.
        await delay(STEP_DELAY_MS);
      }
    }

    console.log("[UI_AutoTest] Завершено. OK:", okCount, "| НЕ OK:", failCount, "| Всего:", MENU_HREFS.length);
  }

  runMenuWalk().catch(function (err) {
    console.error("[UI_AutoTest] Критическая ошибка выполнения:", err);
  });
})();
