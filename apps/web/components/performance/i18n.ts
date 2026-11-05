'use client';
/**
 * The Performance Center's strings. The shared core (metrics, levels, periods, filters) is registered
 * here; each page imports its own catalog from ./messages (for example `./messages/achievements`),
 * so no page carries the others' strings in its first load (the 250 KB budget). Performance code
 * imports `t` from here so the core is always registered before it is used.
 */
import { t } from '@/lib/i18n';
import './messages/core';

export { t };
