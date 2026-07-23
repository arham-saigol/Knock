import { fromZonedTime } from "date-fns-tz";

const PRODUCT_HUNT_TIME_ZONE = "America/Los_Angeles";
const PKT_TIME_ZONE = "Asia/Karachi";

function dateKeyInZone(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function productHuntDay(timestamp = Date.now()) {
  return dateKeyInZone(timestamp, PRODUCT_HUNT_TIME_ZONE);
}

export function pktDay(timestamp = Date.now()) {
  return dateKeyInZone(timestamp, PKT_TIME_ZONE);
}

export function productHuntDayBounds(day: string) {
  const start = fromZonedTime(`${day}T00:00:00`, PRODUCT_HUNT_TIME_ZONE);
  const end = fromZonedTime(`${day}T23:59:59.999`, PRODUCT_HUNT_TIME_ZONE);
  return { start, end };
}

export function isPastDraftStart(timestamp = Date.now()) {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: PKT_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(
    time.map((part) => [part.type, part.value]),
  );
  return (
    Number(values.hour) > 15 ||
    (Number(values.hour) === 15 && Number(values.minute) >= 5)
  );
}
