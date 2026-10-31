// Explicit source currencies only; no automatic rate lookup. DKK accounts remain required.
export const foreignCurrencies=['EUR','USD','GBP','SEK','NOK'] as const;
export const isForeignCurrency=(currency:unknown):boolean=>typeof currency==='string'&&(foreignCurrencies as readonly string[]).includes(currency);
export const sourceCurrencies=['DKK',...foreignCurrencies];
