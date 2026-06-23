# Supabase Setup - VIEWs и RPC функции

## ❌ Что не хватает (404 ошибки)

Фронт ожидает эти объекты в Supabase:

### 1. VIEWs (таблицы для чтения)

#### `v_participant_running_balance`
**Используется:** Админ-дашборд (остатки по контрагентам)

Должна содержать:
- `participant_id` (bigint)
- `shop_id` (bigint, nullable)
- `currency` (char(3), по умолчанию 'RUB')
- `op_date` (date)
- `day_delta` (bigint)
- `running_total` (bigint) — накопительный остаток

**Источник:** Читать из `balance_snapshots` или пересчитать из Operations

```sql
-- Пример (адаптировать под твою схему):
CREATE OR REPLACE VIEW v_participant_running_balance AS
SELECT 
  participant_id,
  shop_id,
  currency,
  created_at::date as op_date,
  last_amount as running_total,
  0 as day_delta  -- пересчитать если нужно
FROM "Snapshot"
ORDER BY created_at DESC;
```

---

#### `v_worker_salary`
**Используется:** Админ-панель "Зарплаты"

Должна содержать:
- `worker_id` (bigint) — Participants.id работника
- `op_date` (date)
- `accrued` (bigint) — начислено
- `drawn` (bigint) — выплачено
- `running_total` (bigint) — итого (accrued - drawn)

**Источник:** Читать из Operations где kind IN ('salary_accrual', 'salary_draw')

```sql
-- Пример (адаптировать):
CREATE OR REPLACE VIEW v_worker_salary AS
SELECT 
  o.from as worker_id,
  o.op_date,
  COALESCE(SUM(CASE WHEN o.kind = 'salary_accrual' THEN o.amount ELSE 0 END), 0) as accrued,
  COALESCE(SUM(CASE WHEN o.kind = 'salary_draw' THEN o.amount ELSE 0 END), 0) as drawn,
  COALESCE(SUM(CASE WHEN o.kind = 'salary_accrual' THEN o.amount ELSE 0 END), 0) -
  COALESCE(SUM(CASE WHEN o.kind = 'salary_draw' THEN o.amount ELSE 0 END), 0) as running_total
FROM "Operations" o
GROUP BY o.from, o.op_date
ORDER BY o.op_date DESC;
```

---

### 2. RPC функции

#### `is_admin()`
**Используется:** Определение роли при логине

```sql
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() AND role = 'admin'
  );
END;
$$;
```

---

#### `current_person_id()`
**Используется:** Определение текущего участника (Participants.id)

```sql
CREATE OR REPLACE FUNCTION current_person_id()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  person_id BIGINT;
BEGIN
  SELECT id INTO person_id FROM "Participants"
  WHERE user_id = auth.uid()
  LIMIT 1;
  RETURN person_id;
END;
$$;
```

---

#### `user_shop_ids()`
**Используется:** Получить список точек (магазинов) пользователя

```sql
CREATE OR REPLACE FUNCTION user_shop_ids()
RETURNS SETOF BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Если админ — все точки
  IF is_admin() THEN
    RETURN QUERY SELECT DISTINCT shop_id FROM shop_members;
  ELSE
    -- Если worker — только его точки
    RETURN QUERY 
      SELECT shop_id FROM shop_members 
      WHERE person_id = current_person_id();
  END IF;
END;
$$;
```

---

### 3. Таблицы и поля

#### `user_roles`
Должна существовать:
```sql
CREATE TABLE IF NOT EXISTS user_roles (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  role TEXT NOT NULL CHECK (role IN ('admin', 'worker')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);
```

#### `shop_members`
Должна существовать:
```sql
CREATE TABLE IF NOT EXISTS shop_members (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  shop_id BIGINT NOT NULL,
  person_id BIGINT NOT NULL REFERENCES "Participants"(id),
  role_at_shop TEXT DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shop_id, person_id)
);
```

#### `Operations` — проверить поля
Должны быть:
- `id` (bigint PRIMARY KEY)
- `op_date` (date) — **NOT NULL**
- `shop_id` (bigint)
- `from` (bigint) — **зарезервированное слово, в кавычках "from"**
- `to` (bigint)
- `amount` (bigint) — целые рубли
- `kind` (text) — revenue, expense, transfer, salary_accrual, salary_draw, goods, adjustment
- `currency` (char(3)) DEFAULT 'RUB'
- `note` (text, nullable)
- `created_by` (uuid) **DEFAULT auth.uid()**
- `created_at` (timestamptz) DEFAULT NOW()

---

## 🔐 RLS политики (важно!)

После создания VIEWs и RPC, добавить RLS:

```sql
-- Для v_participant_running_balance: только админ может читать
ALTER TABLE v_participant_running_balance ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_read_balances ON v_participant_running_balance
  FOR SELECT TO authenticated
  USING (is_admin());

-- Для v_worker_salary: админ читает все, worker читает свою
ALTER TABLE v_worker_salary ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_read_salaries ON v_worker_salary
  FOR SELECT TO authenticated
  USING (is_admin());
CREATE POLICY worker_read_own_salary ON v_worker_salary
  FOR SELECT TO authenticated
  USING (worker_id = current_person_id());
```

---

## 📝 Чеклист

- [ ] Создать VIEWs: `v_participant_running_balance`, `v_worker_salary`
- [ ] Создать RPC: `is_admin()`, `current_person_id()`, `user_shop_ids()`
- [ ] Создать таблицы: `user_roles`, `shop_members` (если нет)
- [ ] Проверить поля в `Operations` (op_date, shop_id, created_by DEFAULT)
- [ ] Включить RLS и добавить политики для админа/worker
- [ ] Вставить записи в `user_roles` (указать кто админ, кто worker)
- [ ] Вставить записи в `shop_members` (кто на какой точке)

---

## 🧪 Тестирование

После создания всего:
1. Запусти `npm run dev`
2. Залогинься с админ аккаунтом → должны загрузиться данные дашборда
3. Залогинься с worker аккаунтом → должны видеть только свои данные
4. Проверь консоль браузера на ошибки Supabase

Если всё ещё 404 — проверь, существуют ли объекты в Supabase:
```sql
SELECT * FROM information_schema.views WHERE table_name LIKE 'v_%';
SELECT routine_name FROM information_schema.routines WHERE routine_name LIKE 'is_%';
```
