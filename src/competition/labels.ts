// Человекочитаемые подписи сигналов конкуренции (RU) — одна точка правды
// для CLI-вывода и экспорта. Исходные украинские значения djinni хранятся
// в рекорде как есть, здесь — только отображение.
import type { RecruiterActivity } from "@prisma/client";

const ACTIVITY_RU: Record<RecruiterActivity, string> = {
  VERY_HIGH: "очень высокая",
  HIGH: "высокая",
  MEDIUM: "средняя",
  LOW: "низкая",
  UNKNOWN: "нет данных",
};

export function recruiterActivityRu(activity: RecruiterActivity | string): string {
  return ACTIVITY_RU[activity as RecruiterActivity] ?? "нет данных";
}

/** «18 дн. назад» / «вчера» — по целым дням от момента ответа до сейчас. */
export function daysAgoRu(days: number): string {
  if (days < 1) return "сегодня";
  if (days === 1) return "вчера";
  const n = Math.round(days);
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? "день"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "дня"
        : "дней";
  return `${n} ${word} назад`;
}

/** ISO-дата без времени: 2026-10-14. */
export function isoDate(d: Date | null): string {
  return d === null ? "—" : d.toISOString().slice(0, 10);
}

/** Перцентиль → «p72»; недоступный (маленькая выборка) → «—». */
export function percentileLabel(p: number | null): string {
  return p === null ? "—" : `p${Math.round(p * 100)}`;
}
