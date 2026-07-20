// Курсы валют НБ РБ (§11): https://api.nbrb.by/exrates/rates/<CODE>?parammode=2
// Курс — BYN за 1 единицу валюты (Cur_OfficialRate / Cur_Scale).
// Отдельного кэша нет: курс фиксируется в записи операции (Payment.rate/rateDate),
// сюда обращаемся только в момент внесения/правки операции.

export const CURRENCIES = ["BYN", "RUB", "USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

export type NbrbRate = {
  rate: number; // BYN за 1 единицу валюты
  date: string; // YYYY-MM-DD — дата курса НБ РБ
};

function toDateParam(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Курс НБ РБ на дату (по умолчанию — сегодня). Для BYN всегда 1.
// При недоступности API — ошибка: пользователь введёт курс вручную (§19).
export async function getNbrbRate(
  currency: string,
  date?: Date,
): Promise<NbrbRate> {
  const day = date ?? new Date();
  if (currency === "BYN") {
    return { rate: 1, date: toDateParam(day) };
  }
  if (!isCurrency(currency)) {
    throw new Error(`Неизвестная валюта: ${currency}`);
  }
  const url = new URL(`https://api.nbrb.by/exrates/rates/${currency}`);
  url.searchParams.set("parammode", "2");
  url.searchParams.set("ondate", toDateParam(day));

  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`НБ РБ вернул ${response.status} для ${currency}`);
  }
  const data = (await response.json()) as {
    Cur_OfficialRate: number;
    Cur_Scale: number;
    Date: string;
  };
  return {
    // округление до 6 знаков — отсекает артефакты float при делении на scale
    rate: Math.round((data.Cur_OfficialRate / data.Cur_Scale) * 1e6) / 1e6,
    date: data.Date.slice(0, 10),
  };
}

// Эквиваленты операции (§11): BYN и валюта проекта.
// projectRate — курс валюты проекта (BYN за единицу); для BYN-проекта = 1.
export function equivalents(
  amount: number,
  rate: number,
  projectRate: number,
): { bynAmount: number; projectAmount: number } {
  const bynAmount = Math.round(amount * rate * 100) / 100;
  const projectAmount =
    projectRate === 1
      ? bynAmount
      : Math.round(((amount * rate) / projectRate) * 100) / 100;
  return { bynAmount, projectAmount };
}

// Перевод BYN-эквивалента в целевую валюту по ТЕКУЩЕМу курсу НБ РБ.
// Нужен зарплатным сводкам, когда валюта ЗП отличается от BYN (редкая
// настройка; операции хранят эквивалент именно в BYN — базовой валюте
// курсов НБ РБ). При недоступности НБ РБ возвращаем сумму как есть.
export async function convertFromByn(
  amount: number,
  currency: string,
): Promise<number> {
  if (currency === "BYN") return amount;
  try {
    const { rate } = await getNbrbRate(currency);
    return Math.round((amount / rate) * 100) / 100;
  } catch {
    return amount;
  }
}
