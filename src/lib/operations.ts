/** Dependency-free local farm records. One atomic key contains current data and its previous good copy. */
export const OPERATIONS_KEY = 'thara_operations_v1';
export interface FarmSettings { farmName: string; currency: string; timeZone: string }
export interface InventoryItem { id: string; name: string; unit: string; reorderThreshold: number }
export interface StockMovement { id: string; itemId: string; type: 'receive' | 'use' | 'adjust'; quantity: number; date: string; note: string }
export interface Equipment { id: string; name: string; meter: number; meterUnit: 'hours' | 'km'; serviceInterval: number | null; serviceIntervalDays: number | null; lastServiceDate: string | null; lastServiceMeter: number }
export interface ServiceRecord { id: string; equipmentId: string; date: string; meter: number; note: string }
export interface Activity { id: string; title: string; date: string; dueDate: string; completed: boolean; note: string }
export interface OperationsData { schemaVersion: 1; revision: number; settings: FarmSettings; inventory: InventoryItem[]; movements: StockMovement[]; equipment: Equipment[]; services: ServiceRecord[]; activities: Activity[] }
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
export class OperationsError extends Error { code: string; constructor(code: string, message: string) { super(message); this.name = 'OperationsError'; this.code = code; } }
function fail(message: string): never { throw new OperationsError('validation', message); }
const MAX = 1_000_000_000;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function newId(): string { return globalThis.crypto.randomUUID(); }
export function createEmptyOperations(): OperationsData { return { schemaVersion: 1, revision: 0, settings: { farmName: '', currency: 'KES', timeZone: 'Africa/Nairobi' }, inventory: [], movements: [], equipment: [], services: [], activities: [] }; }
function object(value: unknown, fields: string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  if (Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => !(key in value))) fail(`${label} has missing or unsupported fields.`);
}
function string(value: unknown, label: string, max = 200, empty = false): asserts value is string { if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`${label} must be text${empty ? '' : ' and cannot be blank'} (maximum ${max} characters).`); }
function number(value: unknown, label: string, min = 0): asserts value is number { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > MAX) fail(`${label} must be a finite number between ${min} and ${MAX}.`); }
export function isValidDate(value: unknown): value is string { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') return false; const d = new Date(`${value}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value; }
function date(value: unknown, label: string): asserts value is string { if (!isValidDate(value)) fail(`${label} must be a real date in YYYY-MM-DD format (1900–9999).`); }
function rows(value: unknown, label: string): asserts value is Record<string, unknown>[] { if (!Array.isArray(value) || value.length > 10000) fail(`${label} must be a list with at most 10,000 records.`); const ids = new Set(); for (const row of value) { if (!row || typeof row !== 'object') fail(`${label} contains an invalid record.`); string(row.id, `${label} ID`, 100); if (ids.has(row.id)) fail(`${label} IDs must be unique.`); ids.add(row.id); } }
const rounded = (value: number) => Math.round(value * 1e6) / 1e6;
export function stockBalance(data: OperationsData, itemId: string): number { return data.movements.filter(m => m.itemId === itemId).reduce((total, m) => total + Math.round((m.type === 'use' ? -m.quantity : m.quantity) * 1e6), 0) / 1e6; }
export function stockStatus(data: OperationsData, itemId: string): 'unrecorded' | 'empty' | 'low' | 'ok' { const item = data.inventory.find(i => i.id === itemId); if (!item) return fail('Inventory item does not exist.'); if (!data.movements.some(m => m.itemId === itemId)) return 'unrecorded'; const balance = stockBalance(data, itemId); return balance === 0 ? 'empty' : balance <= item.reorderThreshold ? 'low' : 'ok'; }
export function validateOperations(input: unknown): OperationsData {
  object(input, ['schemaVersion', 'revision', 'settings', 'inventory', 'movements', 'equipment', 'services', 'activities'], 'Farm records');
  if (input.schemaVersion !== 1) throw new OperationsError('version', 'This backup uses an unsupported schema version. Your stored records have not been changed.');
  number(input.revision, 'Revision'); if (!Number.isSafeInteger(input.revision)) fail('Revision must be a whole number.');
  object(input.settings, ['farmName', 'currency', 'timeZone'], 'Settings'); string(input.settings.farmName, 'Farm name', 200, true); string(input.settings.currency, 'Currency', 3); if (!/^[A-Z]{3}$/.test(input.settings.currency)) fail('Currency must be a three-letter uppercase code.'); if (typeof Intl.supportedValuesOf === 'function' && !Intl.supportedValuesOf('currency').includes(input.settings.currency)) fail('Currency must be a supported ISO currency code.'); string(input.settings.timeZone, 'Time zone', 100); try { new Intl.DateTimeFormat('en', { timeZone: input.settings.timeZone }); } catch { fail('Time zone must be a supported IANA time zone.'); }
  rows(input.inventory, 'Inventory'); rows(input.movements, 'Movements'); rows(input.equipment, 'Equipment'); rows(input.services, 'Services'); rows(input.activities, 'Activities');
  for (const i of input.inventory) { object(i, ['id', 'name', 'unit', 'reorderThreshold'], 'Inventory item'); string(i.name, 'Item name'); string(i.unit, 'Stock unit', 40); number(i.reorderThreshold, 'Reorder threshold'); }
  const balances = new Map(input.inventory.map(i => [i.id, 0]));
  for (const m of input.movements) { object(m, ['id', 'itemId', 'type', 'quantity', 'date', 'note'], 'Movement'); if (!balances.has(m.itemId)) fail('Movement references an unknown item.'); if (!['receive', 'use', 'adjust'].includes(m.type as string)) fail('Movement type must be receive, use or adjust.'); number(m.quantity, 'Quantity', m.type === 'adjust' ? -MAX : 0); if (m.quantity === 0 || (m.type !== 'adjust' && m.quantity < 0)) fail('Movement quantity must be nonzero; receive/use require positive quantities.'); if (Math.abs(m.quantity - rounded(m.quantity)) > Number.EPSILON * Math.max(1, Math.abs(m.quantity))) fail('Movement quantities support at most six decimal places.'); if (Math.abs(m.quantity) < 0.000001) fail('Minimum quantity is 0.000001.'); date(m.date, 'Movement date'); string(m.note, 'Movement note', 2000, m.type !== 'adjust'); const balance = balances.get(m.itemId)! + Math.round((m.type === 'use' ? -m.quantity : m.quantity) * 1e6); if (balance < 0 || balance > MAX * 1e6) fail('Stock movements cannot produce a negative or excessively large balance.'); balances.set(m.itemId, balance); }
  const equipmentIds = new Set(input.equipment.map(e => e.id));
  for (const e of input.equipment) { object(e, ['id', 'name', 'meter', 'meterUnit', 'serviceInterval', 'serviceIntervalDays', 'lastServiceDate', 'lastServiceMeter'], 'Equipment'); string(e.name, 'Equipment name'); number(e.meter, 'Meter'); number(e.lastServiceMeter, 'Last service meter'); if (e.lastServiceMeter > e.meter) fail('Last service meter cannot exceed the current meter.'); if (!['hours', 'km'].includes(e.meterUnit as string)) fail('Meter unit must be hours or km.'); if (e.serviceInterval !== null) number(e.serviceInterval, 'Service interval', 0.000001); if (e.serviceIntervalDays !== null) { number(e.serviceIntervalDays, 'Calendar service interval', 1); if (!Number.isSafeInteger(e.serviceIntervalDays) || e.serviceIntervalDays > 36500) fail('Calendar interval must be a whole number up to 36,500 days.'); } if (e.lastServiceDate !== null) { date(e.lastServiceDate, 'Last service date'); if (e.serviceIntervalDays !== null && new Date(`${e.lastServiceDate}T00:00:00Z`).getTime() + (e.serviceIntervalDays as number) * 86400000 > new Date('9999-12-31T00:00:00Z').getTime()) fail('Next service date exceeds the supported year 9999.'); } }
  const latestServices = new Map<unknown, { date: string; meter: number }>();
  for (const s of input.services) { object(s, ['id', 'equipmentId', 'date', 'meter', 'note'], 'Service'); if (!equipmentIds.has(s.equipmentId)) fail('Service references unknown equipment.'); date(s.date, 'Service date'); number(s.meter, 'Service meter'); string(s.note, 'Service note', 2000, true); const equipment = input.equipment.find(e => e.id === s.equipmentId)!; if (s.meter > (equipment.meter as number)) fail('Service meter cannot exceed the current equipment meter.'); if (equipment.serviceIntervalDays !== null && new Date(`${s.date}T00:00:00Z`).getTime() + (equipment.serviceIntervalDays as number) * 86400000 > new Date('9999-12-31T00:00:00Z').getTime()) fail('Next service date exceeds the supported year 9999.'); const previous = latestServices.get(s.equipmentId); if (previous && (s.date < previous.date || s.meter < previous.meter)) fail('Service records must be appended in date and meter order.'); if (s.meter < (equipment.lastServiceMeter as number) || (equipment.lastServiceDate && s.date < equipment.lastServiceDate)) fail('Service record precedes the initial service baseline.'); latestServices.set(s.equipmentId, { date: s.date, meter: s.meter }); }
  for (const a of input.activities) { object(a, ['id', 'title', 'date', 'dueDate', 'completed', 'note'], 'Activity'); string(a.title, 'Activity title'); date(a.date, 'Activity date'); date(a.dueDate, 'Due date'); if (a.dueDate < a.date) fail('Due date cannot precede the activity date.'); if (typeof a.completed !== 'boolean') fail('Completed must be true or false.'); string(a.note, 'Activity note', 2000, true); }
  return clone(input as unknown as OperationsData);
}
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string { const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now); return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-'); }
export function serviceStatus(data: OperationsData, equipmentId: string, today: string) { date(today, 'Today'); const equipment = data.equipment.find(e => e.id === equipmentId); if (!equipment) return fail('Equipment does not exist.'); const latest = data.services.filter(s => s.equipmentId === equipmentId).at(-1); const lastMeter = latest?.meter ?? equipment.lastServiceMeter; const lastDate = latest?.date ?? equipment.lastServiceDate; const remainingMeter = equipment.serviceInterval === null ? null : rounded(equipment.serviceInterval - (equipment.meter - lastMeter)); const nextServiceDate = lastDate && equipment.serviceIntervalDays !== null ? new Date(new Date(`${lastDate}T00:00:00Z`).getTime() + equipment.serviceIntervalDays * 86400000).toISOString().slice(0, 10) : null; const daysRemaining = nextServiceDate ? Math.round((new Date(`${nextServiceDate}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000) : null; return { scheduleSet: remainingMeter !== null || nextServiceDate !== null, due: (remainingMeter !== null && remainingMeter <= 0) || (daysRemaining !== null && daysRemaining <= 0), remainingMeter, nextServiceDate, daysRemaining, lastServiceDate: lastDate, lastServiceMeter: lastMeter }; }
export function summarizeOperations(data: OperationsData, today: string) { date(today, 'Today'); return { inventoryItems: data.inventory.length, lowStock: data.inventory.filter(i => ['low', 'empty'].includes(stockStatus(data, i.id))).length, equipmentCount: data.equipment.length, serviceDue: data.equipment.filter(e => serviceStatus(data, e.id, today).due).length, openActivities: data.activities.filter(a => !a.completed).length, overdueActivities: data.activities.filter(a => !a.completed && a.dueDate < today).length, dueToday: data.activities.filter(a => !a.completed && a.dueDate === today).length }; }
interface Envelope { current: unknown; previous: unknown; recoveryEvidence?: string }
function decode(raw: string): Envelope { try { const value = JSON.parse(raw); if (!value || typeof value !== 'object' || !('current' in value) || !('previous' in value)) throw new Error(); return value; } catch { throw new OperationsError('corrupt', 'Saved farm records are unreadable. They have been preserved. Export the raw records before clearing storage or restore a valid backup.'); } }
export function createOperationsStore(injectedStorage?: StorageLike) {
  // A revision alone is insufficient after explicit recovery can reuse an old number.
  // Only load() and successful writes advance this instance's observed generation.
  let observedRaw: string | null | undefined;
  const assertObserved = (raw: string | null) => { if (observedRaw !== undefined && raw !== observedRaw) throw new OperationsError('stale', 'Farm records changed in another tab or were recovered. Reload the latest records before saving.'); };
  const storage = (): StorageLike => { try { return injectedStorage ?? globalThis.localStorage; } catch { throw new OperationsError('storage', 'Browser storage is unavailable. Enable local storage to save farm records.'); } };
  const read = (): string | null => { try { return storage().getItem(OPERATIONS_KEY); } catch (e) { if (e instanceof OperationsError) throw e; throw new OperationsError('storage', 'Could not read browser storage. Your records have not been changed.'); } };
  const write = (value: string) => { try { storage().setItem(OPERATIONS_KEY, value); observedRaw = value; } catch { throw new OperationsError('storage', 'Could not save farm records. Browser storage may be full or disabled. Your previous records are unchanged.'); } };
  const current = (raw: string | null) => raw === null ? createEmptyOperations() : validateOperations(decode(raw).current);
  const commit = (next: OperationsData, expectedRevision: number, importing: boolean) => {
    const raw = read(); assertObserved(raw); const previous = current(raw);
    if (previous.revision !== expectedRevision) throw new OperationsError('stale', 'Farm records changed in another tab. Reload the latest records before saving.');
    const validated = validateOperations(next);
    if (!importing) {
      for (const key of ['movements', 'services'] as const) { if (previous[key].length > validated[key].length || previous[key].some((entry, index) => JSON.stringify(entry) !== JSON.stringify(validated[key][index]))) fail('Stock and service history is append-only. Add a correction instead of editing or deleting history.'); }
      for (const old of previous.inventory) { const item = validated.inventory.find(i => i.id === old.id); if (item && item.unit !== old.unit && previous.movements.some(m => m.itemId === old.id)) fail('The unit of an item with stock history cannot change.'); }
      for (const old of previous.equipment) { const item = validated.equipment.find(e => e.id === old.id); if (item && (item.meter < old.meter || item.meterUnit !== old.meterUnit || item.lastServiceDate !== old.lastServiceDate || item.lastServiceMeter !== old.lastServiceMeter)) fail('Equipment meters cannot go backward, change units or rewrite the initial service baseline. Record a service in history.'); }
    }
    validated.revision = previous.revision + 1; validateOperations(validated);
    if (read() !== raw) throw new OperationsError('stale', 'Farm records changed in another tab. Reload before saving.');
    const envelope: Envelope = { current: validated, previous }; if (raw !== null && decode(raw).recoveryEvidence) envelope.recoveryEvidence = decode(raw).recoveryEvidence;
    write(JSON.stringify(envelope)); return clone(validated);
  };
  const previewImport = (json: string): OperationsData => { if (json.length > 10_000_000) fail('Backup is too large (maximum 10 MB).'); let input: unknown; try { input = JSON.parse(json); } catch { return fail('Backup must be valid JSON.'); } return validateOperations(input); };
  return {
    load: () => { const raw = read(); observedRaw = raw; return current(raw); },
    save: (next: OperationsData, expectedRevision: number) => commit(next, expectedRevision, false),
    exportJSON: () => JSON.stringify(current(read()), null, 2),
    exportRaw: () => read(),
    previewImport,
    importJSON: (json: string, expectedRevision: number) => commit(previewImport(json), expectedRevision, true),
    recoverImportJSON: (json: string, expectedRaw: string): OperationsData => {
      const validated = previewImport(json); const raw = read(); if (raw !== expectedRaw) throw new OperationsError('stale', 'Stored records changed. Export the current raw records and review recovery again.');
      let activeValid = false; try { current(raw); activeValid = true; } catch { /* Recovery only replaces corrupt data after explicit review. */ }
      if (activeValid) throw new OperationsError('recovery', 'Current records are valid. Use the normal reviewed import instead.');
      validated.revision += 1; validateOperations(validated); if (read() !== raw) throw new OperationsError('stale', 'Records changed during recovery. Review recovery again.');
      write(JSON.stringify({ current: validated, previous: null, recoveryEvidence: raw })); return clone(validated);
    },
    hasBackup: () => { const raw = read(); if (raw === null) return false; try { validateOperations(decode(raw).previous); return true; } catch { return false; } },
    restoreBackup: (expectedRevision: number | null): OperationsData => {
      const raw = read(); if (raw === null) throw new OperationsError('backup', 'No previous backup is available.'); assertObserved(raw); const envelope = decode(raw); let active: OperationsData | null = null; try { active = validateOperations(envelope.current); } catch { /* Explicit recovery below preserves the rejected raw envelope. */ }
      if (active ? active.revision !== expectedRevision : expectedRevision !== null) throw new OperationsError('stale', 'Reload the current records before restoring the previous backup.');
      let restored: OperationsData; try { restored = validateOperations(envelope.previous); } catch { throw new OperationsError('backup', 'The previous backup is unavailable or invalid. Stored records have been preserved.'); }
      restored.revision = Math.max(active?.revision ?? 0, restored.revision) + 1; validateOperations(restored);
      if (read() !== raw) throw new OperationsError('stale', 'Records changed during recovery. Reload before restoring.');
      write(JSON.stringify({ current: restored, previous: active ?? envelope.previous, ...(active ? (envelope.recoveryEvidence ? { recoveryEvidence: envelope.recoveryEvidence } : {}) : { recoveryEvidence: raw }) })); return clone(restored);
    },
  };
}
