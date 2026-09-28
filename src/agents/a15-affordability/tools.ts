import { z } from 'zod';
import type { ToolGateway } from '../../runtime/tool-gateway.js';
import { CurrencySchema } from '../../shared/money.js';
import type { CalendarDate } from '../../shared/time.js';
import type { RateAssumption } from './ledger.js';

/**
 * Exchange rates for affordability scenarios (15 "Multi year and currency
 * scenarios", "Recovery efficiency"). The tool only answers "one unit of X in
 * Y as of a date"; it has no access to student data. When the provider is
 * missing or fails, the answer says so and the planner either uses a rate the
 * student approved as a scenario assumption or leaves the conversion
 * unresolved (15T18). A live rate is never mixed silently with fixed ones.
 */

export interface ExchangeRateProvider {
  rate(from: string, to: string): Promise<{ rate: string; asOf: CalendarDate }>;
}

export type ExchangeRateOutcome = { available: true; rate: RateAssumption } | { available: false; reason: 'not_configured' | 'provider_error' | 'invalid_rate'; detail: string };

export function registerFinanceTools(gateway: ToolGateway, provider?: ExchangeRateProvider): void {
  gateway.register({
    name: 'finance.exchange_rate',
    description: 'A reference exchange rate: how many units of `to` one unit of `from` is worth, with its date.',
    kind: 'read',
    args: z.object({ from: CurrencySchema, to: CurrencySchema }).strict(),
    handler: async (_inv, args): Promise<ExchangeRateOutcome> => {
      if (!provider) return { available: false, reason: 'not_configured', detail: 'No exchange-rate service is configured.' };
      let r: { rate: string; asOf: CalendarDate };
      try {
        r = await provider.rate(args.from, args.to);
      } catch (e) {
        return { available: false, reason: 'provider_error', detail: e instanceof Error ? e.message.slice(0, 200) : 'rate lookup failed' };
      }
      if (!/^\d+(\.\d+)?$/.test(r.rate) || Number(r.rate) <= 0) return { available: false, reason: 'invalid_rate', detail: 'The service returned an unusable rate.' };
      return { available: true, rate: { from: args.from, to: args.to, rate: r.rate, asOf: r.asOf, source: 'provider' } };
    },
  });
}
