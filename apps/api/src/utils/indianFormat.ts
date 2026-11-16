export function parseIndianNumber(val: string | number): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  // Remove currency symbols, INR, Rs, spaces, and commas
  const cleaned = String(val).replace(/INR|Rs\.?|\s|,/gi, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export function formatIndianCurrency(num: number): string {
  const parts = num.toFixed(2).split('.');
  let lastThree = parts[0].substring(parts[0].length - 3);
  const otherNumbers = parts[0].substring(0, parts[0].length - 3);
  if (otherNumbers !== '') {
    lastThree = ',' + lastThree;
  }
  const res = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;
  return `Rs ${res}.${parts[1]}`;
}
