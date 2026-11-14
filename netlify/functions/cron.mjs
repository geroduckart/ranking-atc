/**
 * Ranking ATC — tareas automáticas cada hora:
 * retos caducados (3 días), recordatorios (2 días) y resultados sin confirmar (48 h).
 */
import { runCron } from './api.mjs';

export default async function () {
  const log = await runCron();
  console.log('cron', JSON.stringify(log));
  return new Response(JSON.stringify(log), { headers: { 'Content-Type': 'application/json' } });
}

export const config = { schedule: '@hourly' };
