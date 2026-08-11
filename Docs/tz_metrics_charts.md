# Техническое задание  
## Метрики, расчёты и графики

> **Статус внедрения (2.4.23):** реализовано во вкладке «Статистика и анализ»  
> `sum-distribution.html`. Описание адаптации и UI: [`ANALYSIS_METRICS.md`](ANALYSIS_METRICS.md).  
> Поля ТЗ → страницы: `growth_sum`→`amount`, `tb_id`→`tb`, `gosb_id`→`gosb`,  
> `cluster_id`→`cluster`, `tab_num`→`tn`.

## 1. Уровни агрегации

Агрегации считаются по полю группировки:

- все данные (без группировки);
- по `tb_id` (ТБ);
- по `cluster_id` (кластеры);
- по `gosb_id` (госб);
- по `tab_num` (табельные).

Для каждой группы считаются одни и те же метрики.

---

## 2. Базовые статистики по `growth_sum`

Для каждой группы:

- `N` — количество записей;
- `sum_growth` — сумма `growth_sum`;
- `avg_growth` — среднее:  
  `avg_growth = sum_growth / N`
- `median_growth` — медиана `growth_sum`;
- `min_growth`, `max_growth`;
- `std_growth` — стандартное отклонение (выборочное, `N-1`);
- `q1_growth`, `q3_growth` — 1‑й и 3‑й квартили;
- `iqr_growth = q3_growth - q1_growth`;
- `count_pos` — число записей с `growth_sum > 0`;
- `count_neg` — число записей с `growth_sum < 0`;
- `count_zero` — число записей с `growth_sum = 0`;
- `share_pos = count_pos / N`;
- `share_neg = count_neg / N`;
- `share_zero = count_zero / N`.

---

## 3. Метрики для ранжирования (ТБ / госб / табельные)

Для каждого уникального `tb_id`, `gosb_id`, `tab_num`:

- `sum_growth`;
- `avg_growth`;
- `median_growth`;
- `share_pos`;
- `score`.

### 3.1. Композитный score

Для выбранного уровня (ТБ / госб / табельные):

1. По всем объектам уровня считаются:
   - `mu_avg`, `sigma_avg` — среднее и std `avg_growth`;
   - `mu_med`, `sigma_med` — среднее и std `median_growth`;
   - `mu_share`, `sigma_share` — среднее и std `share_pos`.

2. Для каждого объекта:
   ```
   Z_avg = (avg_growth - mu_avg) / sigma_avg
   Z_med = (median_growth - mu_med) / sigma_med
   Z_share = (share_pos - mu_share) / sigma_share
   ```
   Если `sigma = 0`, соответствующий `Z = 0`.

3. Score:
   ```
   Score = w1 * Z_avg + w2 * Z_med + w3 * Z_share
   ```
   По умолчанию: `w1 = 0.5, w2 = 0.3, w3 = 0.2`.

---

## 4. Логика отбора «лучших」

Уровень: `TB` / `GOSB` / `TAB`.

Метрика ранжирования: `sum_growth` / `avg_growth` / `median_growth` / `share_pos` / `score`.

### 4.1. Top‑N

Параметр: `N`.

- Объекты сортируются по выбранной метрике по убыванию.
- Выбираются первые `N`.
- Если `N > M`, выбираются все.

### 4.2. Top‑X%

Параметр: `percent`.

- `M` — число объектов уровня;
- `N = ceil(M * percent / 100)`;
- далее как в Top‑N.

### 4.3. «Шишки」

Параметры:

- `outlier_type` ∈ { 'percentile', 'zscore', 'abs' };
- `threshold`;
- `metric_for_outlier` ∈ { 'score', 'avg_growth', ... };
- `metric` — метрика для финальной сортировки.

Логика:

- `percentile`:
  - вычисляется процентиль `T` по `metric_for_outlier`;
  - «шишки」 = объекты с `metric_for_outlier >= T`.
- `zscore`:
  - по `metric_for_outlier` считаются `mu`, `sigma`;
  - `Z = (metric_for_outlier - mu) / sigma`;
  - «шишки」 = объекты с `Z >= threshold`.
- `abs`:
  - «шишки」 = объекты с `avg_growth >= threshold` (в млрд).

Отобранные объекты сортируются по `metric` по убыванию.

---

## 5. Графики и визуализация

### 5.1. Гистограмма распределения `growth_sum`

- Ось X: `growth_sum` (бины по 1–2 млрд или по квантилям);
- Ось Y: частота или доля;
- Вертикальная линия на 0.

Строится:

- для всех данных;
- отдельно по `tb_id`;
- отдельно по `cluster_id`.

### 5.2. Boxplot (ящик с усами)

- Ось X: категория (`tb_id` / `cluster_id` / `gosb_id`);
- Ось Y: `growth_sum`.

Показывает:

- медиану, Q1, Q3;
- «усы」(например, 1.5×ıQR);
- выбросы.

Варианты:

- boxplot по ТБ (11 ящиков);
- boxplot по кластерам (5 ящиков);
- boxplot по госб (выборочно или все).

### 5.3. Bar chart средних / медиан

- Ось X: `tb_id` / `cluster_id` / `gosb_id`;
- Ось Y: `avg_growth` или `median_growth`.

Назначение:

- сравнение уровней между собой;
- ранжирование ТБ / кластеров / госб.

### 5.4. Рейтинг (sorted bar chart)

Для выбранных «лучших」:

- Ось X: значение метрики (`score` / `avg_growth`);
- Ось Y: `id` объекта (ТБ / госб / табельный), отсортированные по убыванию.

Отображает:

- топ‑N / топ‑X% / «шишки」в виде упорядоченной столбчатой диаграммы.

### 5.5. Тепловая карта (heatmap)

Варианты:

- строки: `gosb_id`, столбцы: `tb_id`;
- строки: `gosb_id`, столбцы: `cluster_id`;
- цвет: `avg_growth` / `median_growth` / `share_pos`.

Назначение:

- показать, какие госб стабильно сильны/слабы в разных ТБ / кластерах.

### 5.6. Кумулятивная кривая (CDF)

- Ось X: `growth_sum`;
- Ось Y: доля наблюдений ≤ данного значения.

Строится:

- одна общая кривая;
- отдельные кривые по ТБ / кластерам (разными цветами).

Позволяет сравнивать распределения и видеть долю отрицательных/положительных.

### 5.7. Профили госб / табельных

- Ось X: `tb_id` / `cluster_id`;
- Ось Y: `avg_growth` для конкретного `gosb_id` (или `tab_num`);
- отдельная линия для каждого выбранного госб / табельного.

Показывает устойчивость результатов объекта по разным ТБ / кластерам.

---

## 6. Расчёты для режимов «лучших」

### 6.1. Вход

- файл данных: `tb_id`, `cluster_id`, `gosb_id`, `tab_num`, `growth_sum`;
- параметры:
  - `level` ∈ {TB, GOSB, TAB};
  - `mode` ∈ {TOP_N, TOP_PERCENT, OUTLIERS};
  - `metric` ∈ {sum_growth, avg_growth, median_growth, share_pos, score};
  - параметры режима (`N`, `percent`, `outlier_type`, `threshold`, `metric_for_outlier`).

### 6.2. Шаги расчёта

1. Агрегация по уровню:
   - группировка по `tb_id` / `gosb_id` / `tab_num`;
   - расчёт `N`, `sum_growth`, `avg_growth`, `median_growth`, `share_pos`.

2. Расчёт `score` для уровня (если используется):
   - по всем объектам уровня: `mu` и `sigma` для `avg_growth`, `median_growth`, `share_pos`;
   - для каждого объекта: `Z_avg`, `Z_med`, `Z_share`, `score`.

3. Отбор по режиму:
   - Top‑N: взять первые `N` после сортировки по `metric`;
   - Top‑X%: `N = ceil(M * percent / 100)`, далее как Top‑N;
   - Outliers:
     - вычислить порог по `metric_for_outlier` (процентиль / z‑score / abs);
     - отфильтровать объекты;
     - отсортировать по `metric`.

4. Для отобранных объектов:
   - присвоить `rank` (1..N);
   - вернуть: `id`, `sum_growth`, `avg_growth`, `median_growth`, `share_pos`, `score`, `rank`.

### 6.3. Подсказки

- `M` — число объектов уровня;
- `N` — число отобранных;
- `percent = N / M * 100`;
- текст:
  - Top‑N: «Показаны лучшие N объектов из M (percent%). Ранжирование по метрике «{metric}」.」
  - Top‑X%: «Показаны лучшие X% объектов: N из M (percent%). Ранжирование по метрике «{metric}」.」
  - Outliers: «Найдено N объектов‑「шишек」(выше threshold‑го процентиля / Z > threshold / avg ≥ threshold млрд) из M (percent%). Ранжирование по метрике «{metric}」.」

---

## 7. Рекомендуемые значения параметров

Для уровня:

- `TB` (M = 11):
  - N: 3, 5, 7;
  - %: 20, 40, 60.
- `GOSB` (M = 110):
  - N: 10, 20, 30;
  - %: 10, 20, 30.
- `TAB` (M ≈ 2000):
  - N: 50, 100, 200;
  - %: 2.5, 5, 10.

Для «шишек」:

- процентиль: 85, 90, 95;
- z‑score: 1.5, 2.0;
- abs (для `avg_growth`, млрд): 0.5, 1.0, 2.0.
