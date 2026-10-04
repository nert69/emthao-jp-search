import { jpyToVnd, jpyToGbp, formatJpy, formatVnd, formatGbp } from '../lib/pricing';

export function PriceBlock({ jpy, weightKg, pricing }) {
  const vnd = pricing?.displayCurrency === 'vnd';
  const estimate = vnd ? jpyToVnd(jpy, weightKg, pricing) : jpyToGbp(jpy, pricing);
  return (
    <div className="price-block">
      <div className="price-jpy">{formatJpy(jpy)}</div>
      <div className="price-vnd" title={vnd ? 'Estimated total including configured markup and weight-based shipping' : 'Approximate item price in GBP; fees, shipping and taxes are extra'}>
        ≈ {vnd ? formatVnd(estimate) : formatGbp(estimate)}
      </div>
    </div>
  );
}
