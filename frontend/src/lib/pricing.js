// VND = JPY × rate × (1 + markupPct/100) + weightKg × shipVndPerKg
export function jpyToVnd(jpy, weightKg, cfg) {
  if (!Number.isFinite(jpy) || jpy <= 0 || !cfg) return null;
  const base = jpy * cfg.rate;
  const withMarkup = base * (1 + cfg.markupPct / 100);
  const ship = (weightKg ?? cfg.defaultWeightKg ?? 0) * cfg.shipVndPerKg;
  return Math.round(withMarkup + ship);
}

export function formatJpy(n) {
  if (!Number.isFinite(n)) return '—';
  return `¥${n.toLocaleString('ja-JP')}`;
}

export function formatVnd(n) {
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('vi-VN')} đ`;
}
// ECB reference snapshot, 2 October 2026: EUR 1 = GBP 0.85033 = JPY 176.99.
// This is an item-price estimate; proxy fees, delivery and taxes are extra.
export const GBP_RATE = 0.85033 / 176.99;
export const GBP_RATE_DATE = '2 Oct 2026';
export const GBP_RATE_SOURCE = 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html';

export function jpyToGbp(jpy, cfg) {
  const rate = cfg?.gbpRate ?? GBP_RATE;
  if (!Number.isFinite(jpy) || jpy < 0 || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(jpy * rate * 100) / 100;
}

export function formatGbp(n) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
}
