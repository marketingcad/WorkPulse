import type { z } from 'zod';
import type { Actor } from '../../../context';
import type { Ctx } from '../../ctx';

export interface NavLink {
  key: string;
  label: string;
  href: string;
}

export interface AssistantTool<I = unknown> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  /** Gate permission(s): the tool set is built per actor, and each call is checked again. */
  allowed(actor: Actor): boolean;
  /** UI label key shown while the tool runs, e.g. 'checking_timesheets'. */
  statusKey: string;
  run(x: Ctx, input: I): Promise<{ data: unknown; nav?: NavLink[] }>;
}
