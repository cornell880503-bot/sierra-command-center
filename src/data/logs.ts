import type { AppMode, FrictionLog } from '../types';
import { generateLogs } from './generateLogs';

export function getLogsForMode(mode: AppMode): FrictionLog[] {
  return generateLogs(mode);
}
