import { useId, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { createEmptyOperations, createOperationsStore, newId, serviceStatus, OPERATIONS_KEY, stockBalance, stockStatus, todayInTimeZone, type OperationsData } from "@/lib/operations";
import "@/local-farm.css";

type Section = "overview" | "inventory" | "equipment" | "activities" | "settings";
const sections: { id: Section; label: string; mark: string }[] = [
  { id: "overview", label: "Overview", mark: "01" }, { id: "inventory", label: "Inventory", mark: "02" },
  { id: "equipment", label: "Equipment", mark: "03" }, { id: "activities", label: "Activities", mark: "04" },
  { id: "settings", label: "Farm & backups", mark: "05" },
];
const numeric = (form: FormData, key: string) => Number(form.get(key));
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optionalNumber = (form: FormData, key: string) => text(form, key) === "" ? null : numeric(form, key);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Could not save these records. Please try again.";
const number = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);
function dateLabel(date: string) { return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); }
function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return <label className="lf-field" htmlFor={id}><span>{label}</span><input id={id} {...props} /></label>;
}
function Select({ label, name, children, defaultValue }: { label: string; name: string; children: ReactNode; defaultValue?: string }) {
  const id = useId();
  return <label className="lf-field" htmlFor={id}><span>{label}</span><select id={id} name={name} defaultValue={defaultValue}>{children}</select></label>;
}
function Form({ children, onSave, submit, disabled = false }: { children: ReactNode; onSave: (form: FormData) => boolean | Promise<boolean>; submit: string; disabled?: boolean }) {
  const [pending, setPending] = useState(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    try { if (await onSave(new FormData(form))) form.reset(); } finally { setPending(false); }
  }
  return <form onSubmit={handleSubmit}><fieldset disabled={disabled || pending} className="lf-form"><div className="lf-fields">{children}</div><button className="lf-button lf-primary" type="submit">{submit}</button></fieldset></form>;
}
function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="lf-empty"><h3>{title}</h3><p>{children}</p></div>; }
function Heading({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) { return <header className="lf-section-heading"><p className="lf-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{children}</p></header>; }
async function withWriteLock<T>(action: () => T): Promise<T> {
  if (navigator.locks) return navigator.locks.request("thara-operations-write", action);
  throw new Error("This browser cannot safely coordinate saves. Use a current browser on HTTPS or localhost. You can still export existing records.");
}
function downloadText(contents: string, filename: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function LocalFarmPage() {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [store] = useState(() => createOperationsStore());
  const [initial] = useState(() => {
    try { return { data: store.load(), error: "" }; }
    catch (error) { return { data: createEmptyOperations(), error: errorMessage(error) }; }
  });
  const [data, setData] = useState(initial.data);
  const [blocked, setBlocked] = useState(Boolean(initial.error));
  const [section, setSection] = useState<Section>("overview");
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(initial.error ? { message: initial.error, error: true } : null);
  const [importPreview, setImportPreview] = useState<{ json: string; name: string; data: OperationsData; raw: string | null } | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastExport, setLastExport] = useState<number | null>(null);
  const [activityFilter, setActivityFilter] = useState("open");
  const today = todayInTimeZone(data.settings.timeZone);
  const lowStock = data.inventory.filter(item => ["empty", "low"].includes(stockStatus(data, item.id)));
  const dueEquipment = data.equipment.filter(item => serviceStatus(data, item.id, today).due);
  const openActivities = data.activities.filter(item => !item.completed);
  const dueActivities = openActivities.filter(item => item.dueDate <= today);
  const upcomingActivities = [...openActivities].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  async function save(update: (next: OperationsData) => void, message: string) {
    if (blocked || saving) return false;
    setSaving(true);
    try {
      const next = structuredClone(data);
      update(next);
      setData(await withWriteLock(() => store.save(next, data.revision)));
      setNotice({ message, error: false });
      return true;
    } catch (error) { setNotice({ message: errorMessage(error), error: true }); return false; } finally { setSaving(false); }
  }
  function reload() {
    try { setData(store.load()); setBlocked(false); setNotice({ message: "Loaded the latest records from this browser.", error: false }); }
    catch (error) { setBlocked(true); setNotice({ message: errorMessage(error), error: true }); }
  }
  function exportBackup() {
    try {
      const exported = store.exportJSON();
      downloadText(exported, `thara-farm-${today}.json`);
      setLastExport(JSON.parse(exported).revision as number);
      setNotice({ message: "Backup download requested. Check your downloads and keep a copy outside this browser.", error: false });
    } catch (error) { setNotice({ message: errorMessage(error), error: true }); }
  }
  async function previewFile(file?: File) {
    if (!file) return;
    setImportPreview(null);
    try {
      if (file.size > 10_000_000) throw new Error("This backup exceeds the 10 MB import limit.");
      const json = await file.text();
      setImportPreview({ json, name: file.name, data: store.previewImport(json), raw: store.exportRaw() });
      setRestoreConfirm(false);
      setNotice({ message: "Backup checked. Review the record counts below before replacing your records.", error: false });
    } catch (error) { setNotice({ message: errorMessage(error), error: true }); }
  }
  async function confirmImport() {
    if (!importPreview || saving) return;
    setSaving(true);
    try {
      setData(await withWriteLock(() => blocked && importPreview.raw !== null ? store.recoverImportJSON(importPreview.json, importPreview.raw) : store.importJSON(importPreview.json, data.revision))); setBlocked(false); setImportPreview(null);
      setNotice({ message: "Backup imported and saved in this browser.", error: false });
    } catch (error) { setNotice({ message: errorMessage(error), error: true }); } finally { setSaving(false); }
  }
  async function restoreBackup() {
    if (saving) return;
    setSaving(true);
    try {
      setData(await withWriteLock(() => store.restoreBackup(blocked ? null : data.revision))); setBlocked(false); setRestoreConfirm(false);
      setNotice({ message: "Previous saved version restored.", error: false });
    } catch (error) { setNotice({ message: errorMessage(error), error: true }); } finally { setSaving(false); }
  }
  function exportRaw() {
    try { const raw = store.exportRaw(); if (!raw) throw new Error("No stored operations data to export."); downloadText(raw, `thara-recovery-${today}.json`); setNotice({ message: "Raw recovery download requested. Keep this file unchanged for troubleshooting; it is not a standard import backup.", error: false }); }
    catch (error) { setNotice({ message: errorMessage(error), error: true }); }
  }
  function exportLegacy() {
    try {
      const records: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith("thara_") && key !== OPERATIONS_KEY) records[key] = localStorage.getItem(key) ?? ""; }
      const sessionRecords: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i++) { const key = sessionStorage.key(i); if (key?.startsWith("thara_")) sessionRecords[key] = sessionStorage.getItem(key) ?? ""; }
      if (!Object.keys(records).length && !Object.keys(sessionRecords).length) throw new Error("No older Thara records were found in this browser.");
      downloadText(JSON.stringify({ format: "thara-legacy-archive", exportedAt: new Date().toISOString(), records, sessionRecords }, null, 2), `thara-legacy-archive-${today}.json`);
      setNotice({ message: "Legacy archive download requested. This preserves older records separately and is not an operations import file.", error: false });
    } catch (error) { setNotice({ message: errorMessage(error), error: true }); }
  }
  let hasBackup = false;
  try { hasBackup = store.hasBackup(); } catch { /* Storage errors are shown on load or action. */ }
  const go = (next: Section) => { setSection(next); setImportPreview(null); setRestoreConfirm(false); workspaceRef.current?.scrollTo({ top: 0 }); };
  return <div className="lf-app">
    <a className="lf-skip" href="#farm-content">Skip to farm records</a>
    <aside className="lf-sidebar">
      <a className="lf-brand" href="/farm"><span className="lf-brand-name">Thara<span> Farm</span></span><span className="lf-brand-tag">Your farm, thriving.</span></a>
      <p className="lf-nav-caption">FARM RECORDS</p>
      <nav aria-label="Farm sections">{sections.map(item => <button type="button" key={item.id} className={`lf-nav-item ${section === item.id ? "is-active" : ""}`} aria-current={section === item.id ? "page" : undefined} onClick={() => go(item.id)}><span className="lf-nav-mark" aria-hidden="true">{item.mark}</span>{item.label}</button>)}</nav>
      <div className="lf-sidebar-note"><span className="lf-local-dot" /> Stored on this device<p>No account. No subscription.<br />Your records stay in this browser.</p><button type="button" onClick={() => go("settings")}>Keep a backup →</button></div>
    </aside>
    <div className="lf-workspace" ref={workspaceRef}>
      <header className="lf-topbar"><span>{data.settings.farmName || "Your farm"}</span><span>{dateLabel(today)} <span className="lf-timezone">· {data.settings.timeZone}</span></span></header>
      <main id="farm-content" className="lf-main" tabIndex={-1}>
        {!navigator.locks && <div className="lf-warning"><strong>Editing requires browser write locks.</strong><p>Use a current browser on HTTPS or localhost to edit. Existing records can still be exported.</p></div>}
        {notice && <div className={`lf-notice ${notice.error ? "lf-error" : ""}`} role={notice.error ? "alert" : "status"}><p>{notice.message}</p><button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>×</button></div>}
        {blocked && <div className="lf-warning" role="alert"><strong>Records could not be loaded.</strong><p>Saving is paused to protect the existing data. Open Farm & backups to restore a previous version, or retry loading.</p><button className="lf-button" type="button" onClick={reload}>Retry loading</button><button className="lf-button" type="button" onClick={() => go("settings")}>Open backups</button></div>}
        {section === "overview" && <>
          <div className="lf-hero"><div><p className="lf-eyebrow">THE FARM, AT A GLANCE</p><h1>A clear start<br />to the day.</h1><p>Stock, equipment and the work ahead.<br />A record of what matters on your farm.</p></div><div className="lf-hero-note"><span className="lf-hero-date">{new Intl.DateTimeFormat(undefined, { day: "2-digit", timeZone: "UTC" }).format(new Date(`${today}T12:00:00Z`))}</span><span>{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${today}T12:00:00Z`))}</span><span className="lf-pill">LOCAL FARM RECORDS</span></div></div>
          <div className="lf-stats">
            <button type="button" onClick={() => go("inventory")}><span>Inventory items</span><strong>{data.inventory.length}</strong><small>{lowStock.length ? `${lowStock.length} at or below reorder level` : "Stock register"}<span aria-hidden="true">↗</span></small></button>
            <button type="button" onClick={() => go("equipment")}><span>Equipment</span><strong>{data.equipment.length}</strong><small>{dueEquipment.length ? `${dueEquipment.length} due for service` : "Equipment register"}<span aria-hidden="true">↗</span></small></button>
            <button type="button" onClick={() => go("activities")}><span>Open activities</span><strong>{openActivities.length}</strong><small>{dueActivities.length ? `${dueActivities.length} due today or earlier` : "Your upcoming work"}<span aria-hidden="true">↗</span></small></button>
          </div>
          <div className="lf-overview-grid"><section className="lf-panel"><div className="lf-panel-title"><h2>Next on the farm</h2><button className="lf-link" type="button" onClick={() => go("activities")}>All activities →</button></div>
            {upcomingActivities.length ? <div className="lf-rows">{upcomingActivities.slice(0, 5).map(item => <div key={item.id} className="lf-row"><div><strong>{item.title}</strong><p>Due {dateLabel(item.dueDate)}</p></div><button className="lf-button lf-small" disabled={blocked || saving} type="button" onClick={() => save(next => { next.activities.find(a => a.id === item.id)!.completed = true; }, "Activity marked complete.")}>Mark done</button></div>)}</div> : <Empty title={data.activities.length ? "All caught up" : "Start with the next job"}>Add a dated activity, then tick it off when the work is done.</Empty>}
            <button className="lf-button" type="button" onClick={() => go("activities")}>+ Add an activity</button>
          </section><section className="lf-panel"><div className="lf-panel-title"><h2>Needs attention</h2><span className="lf-pill">{lowStock.length + dueEquipment.length}</span></div>
            {lowStock.length + dueEquipment.length === 0 ? <Empty title="No stock or service alerts">Alerts appear here when your recorded stock reaches its reorder level or equipment is due for service.</Empty> : <div className="lf-rows">{lowStock.map(item => <button className="lf-attention" key={item.id} type="button" onClick={() => go("inventory")}><span><strong>{item.name}</strong><small>{number(stockBalance(data, item.id))} {item.unit} on hand</small></span><span className="lf-pill lf-amber">{stockStatus(data, item.id) === "empty" ? "Empty" : "Low stock"}</span></button>)}{dueEquipment.map(item => <button className="lf-attention" key={item.id} type="button" onClick={() => go("equipment")}><span><strong>{item.name}</strong><small>{number(item.meter)} {item.meterUnit} recorded</small></span><span className="lf-pill lf-amber">Service due</span></button>)}</div>}
          </section></div>
          <div className="lf-backup-strip"><div><strong>A small habit. A safer record.</strong><p>Browser storage can be cleared. Download a backup after important updates.</p></div><button className="lf-button" type="button" disabled={blocked || saving} onClick={exportBackup}>Export backup</button></div>
        </>}
        {section === "inventory" && <>
          <Heading eyebrow="02 / INVENTORY" title="Know what’s on hand.">Track each item in its own unit. Every receipt, use and adjustment stays in the ledger.</Heading>
          <details className="lf-panel lf-create" open={data.inventory.length === 0}><summary>Add an inventory item <span aria-hidden="true">+</span></summary><Form submit="Create inventory item" disabled={blocked || saving} onSave={form => save(next => { next.inventory.push({ id: newId(), name: text(form, "name"), unit: text(form, "unit"), reorderThreshold: numeric(form, "reorder") }); }, "Inventory item created. Record a receipt to add stock.")}><Field name="name" label="Item name" required maxLength={120} placeholder="e.g. Dairy meal" /><Field name="unit" label="Stock unit" required maxLength={30} placeholder="e.g. kg, L, bags" /><Field name="reorder" label="Reorder level (in stock unit)" type="number" min="0" max="1000000000" step="any" defaultValue="0" required /></Form></details>
          {!data.inventory.length && <Empty title="Your stock register is empty">Add an item above, then record its opening stock as a receipt.</Empty>}
          <div className="lf-records">{data.inventory.map(item => <details className="lf-panel lf-record" key={item.id}><summary><span><strong>{item.name}</strong><small>Reorder at {number(item.reorderThreshold)} {item.unit}</small></span><span className="lf-record-value"><strong>{stockStatus(data, item.id) === "unrecorded" ? "—" : number(stockBalance(data, item.id))} <small>{item.unit}</small></strong><span className={`lf-pill ${["empty", "low"].includes(stockStatus(data, item.id)) ? "lf-amber" : ""}`}>{stockStatus(data, item.id) === "ok" ? "In stock" : stockStatus(data, item.id) === "empty" ? "Empty" : stockStatus(data, item.id) === "unrecorded" ? "No stock recorded" : "Low stock"}</span></span></summary>
            <div className="lf-detail"><h3>Record stock movement</h3><p className="lf-help">Receipts add stock. Use removes stock. An adjustment is a signed change (+ or −), not the new total.</p><Form disabled={blocked || saving} submit="Save movement" onSave={form => save(next => { next.movements.push({ id: newId(), itemId: item.id, type: text(form, "type") as "receive" | "use" | "adjust", quantity: numeric(form, "quantity"), date: text(form, "date"), note: text(form, "note") }); }, "Stock movement saved.")}><Select name="type" label="Movement type"><option value="receive">Receive stock</option><option value="use">Use stock</option><option value="adjust">Adjust (+ / −)</option></Select><Field name="quantity" label={`Quantity (${item.unit})`} type="number" step="any" required /><Field name="date" label="Movement date" type="date" defaultValue={today} max={today} required /><Field name="note" label="Reason / reference" maxLength={500} required placeholder="Opening stock" /></Form>
              <h3 className="lf-subheading">Movement ledger</h3><div className="lf-table-wrap"><table><caption className="lf-sr-only">Stock movements for {item.name}</caption><thead><tr><th>Date</th><th>Movement</th><th>Quantity ({item.unit})</th><th>Reason / reference</th></tr></thead><tbody>{[...data.movements].filter(m => m.itemId === item.id).sort((a,b) => b.date.localeCompare(a.date)).map(m => <tr key={m.id}><td>{dateLabel(m.date)}</td><td>{m.type === "receive" ? "Received" : m.type === "use" ? "Used" : "Adjusted"}</td><td className="lf-numeric">{m.type === "use" ? "−" : m.quantity >= 0 ? "+" : ""}{number(m.quantity)}</td><td>{m.note || "—"}</td></tr>)}</tbody></table></div>{!data.movements.some(m => m.itemId === item.id) && <p className="lf-help">No movements recorded yet.</p>}
            </div></details>)}</div>
        </>}
        {section === "equipment" && <>
          <Heading eyebrow="03 / EQUIPMENT" title="Keep the farm running.">Record meter readings and completed services. Due dates and meter intervals use the information you enter.</Heading>
          <details className="lf-panel lf-create" open={data.equipment.length === 0}><summary>Register equipment <span aria-hidden="true">+</span></summary><Form disabled={blocked || saving} submit="Register equipment" onSave={form => save(next => { next.equipment.push({ id: newId(), name: text(form, "name"), meter: numeric(form, "meter"), meterUnit: text(form, "unit") as "hours" | "km", serviceInterval: optionalNumber(form, "interval"), serviceIntervalDays: optionalNumber(form, "days"), lastServiceDate: text(form, "date") || null, lastServiceMeter: numeric(form, "lastMeter") }); }, "Equipment registered.")}><Field name="name" label="Equipment name" maxLength={120} required placeholder="e.g. Irrigation pump" /><Select name="unit" label="Meter unit"><option value="hours">Hours</option><option value="km">Kilometres</option></Select><Field name="meter" label="Current meter reading" type="number" min="0" max="1000000000" step="any" required /><Field name="interval" label="Service interval (meter units, optional)" type="number" min="0.000001" step="any" /><Field name="lastMeter" label="Last service / starting meter" type="number" min="0" max="1000000000" step="any" required /><Field name="date" label="Last service date (optional)" type="date" max={today} /><Field name="days" label="Service interval in days (optional)" type="number" min="1" step="1" /></Form><p className="lf-help">For calendar reminders, enter both a last service date and an interval in days. Use the manufacturer’s recommended intervals.</p></details>
          {!data.equipment.length && <Empty title="Your equipment register is empty">Add the machines you maintain, with their current meter readings and service intervals.</Empty>}
          <div className="lf-records">{data.equipment.map(item => { const due = serviceStatus(data, item.id, today); return <details className="lf-panel lf-record" key={item.id}><summary><span><strong>{item.name}</strong><small>{number(item.meter)} {item.meterUnit} · {item.serviceInterval === null ? "No meter interval" : `Next service at ${number(due.lastServiceMeter + item.serviceInterval)} ${item.meterUnit}`}</small></span><span className={`lf-pill ${due.due ? "lf-amber" : ""}`}>{due.due ? "Service due" : due.scheduleSet ? "Within interval" : "Schedule not set"}</span></summary><div className="lf-detail"><div className="lf-equipment-facts"><p><span>Last service</span><strong>{due.lastServiceDate ? dateLabel(due.lastServiceDate) : "No date recorded"}</strong></p><p><span>Meter interval</span><strong>{item.serviceInterval === null ? "Not set" : `${number(item.serviceInterval)} ${item.meterUnit}`}</strong></p><p><span>Calendar due</span><strong>{due.nextServiceDate ? dateLabel(due.nextServiceDate) : "Not set"}</strong></p></div>
            <h3>Update meter reading</h3><Form disabled={blocked || saving} submit="Save meter reading" onSave={form => save(next => { next.equipment.find(e => e.id === item.id)!.meter = numeric(form, "meter"); }, "Meter reading saved.")}><Field name="meter" label={`New reading (${item.meterUnit})`} type="number" min={item.meter} step="any" required defaultValue={item.meter} /></Form>
            <h3 className="lf-subheading">Record a completed service</h3><p className="lf-help">A service starts a new interval from this reading and date. Include the work performed in the notes.</p><Form disabled={blocked || saving} submit="Save service record" onSave={form => save(next => { const meter = numeric(form, "meter"); const date = text(form, "date"); next.services.push({ id: newId(), equipmentId: item.id, date, meter, note: text(form, "note") }); const equipment = next.equipment.find(e => e.id === item.id)!; equipment.meter = Math.max(equipment.meter, meter); }, "Service recorded. Due state updated.")}><Field name="date" label="Service date" type="date" defaultValue={today} min={due.lastServiceDate ?? undefined} max={today} required /><Field name="meter" label={`Meter at service (${item.meterUnit})`} type="number" min={due.lastServiceMeter} step="any" defaultValue={item.meter} required /><Field name="note" label="Work performed" maxLength={500} required /></Form>
            <h3 className="lf-subheading">Service history</h3>{data.services.some(s => s.equipmentId === item.id) ? <div className="lf-rows">{[...data.services].filter(s => s.equipmentId === item.id).sort((a,b) => b.date.localeCompare(a.date)).map(s => <div className="lf-row" key={s.id}><div><strong>{dateLabel(s.date)} · {number(s.meter)} {item.meterUnit}</strong><p>{s.note}</p></div></div>)}</div> : <p className="lf-help">No service logs yet. Registration details are shown above.</p>}
          </div></details>; })}</div>
        </>}
        {section === "activities" && <>
          <Heading eyebrow="04 / ACTIVITIES" title="A place for the work ahead.">Plan dated farm work and keep completed activities in the record.</Heading>
          <details className="lf-panel lf-create" open={data.activities.length === 0}><summary>Add an activity <span aria-hidden="true">+</span></summary><Form disabled={blocked || saving} submit="Save activity" onSave={form => save(next => { next.activities.push({ id: newId(), title: text(form, "title"), date: text(form, "date"), dueDate: text(form, "dueDate"), completed: false, note: text(form, "note") }); }, "Activity saved.")}><Field name="title" label="Activity" maxLength={120} required placeholder="e.g. Check irrigation lines" /><Field name="date" label="Activity date" type="date" defaultValue={today} required /><Field name="dueDate" label="Due date" type="date" defaultValue={today} required /><Field name="note" label="Notes (optional)" maxLength={500} /></Form></details>
          <div className="lf-filter" role="group" aria-label="Filter activities">{[ ["open", "Open"], ["done", "Completed"], ["all", "All activities"] ].map(([value, label]) => <button type="button" key={value} aria-pressed={activityFilter === value} onClick={() => setActivityFilter(value)}>{label} {value === "open" ? openActivities.length : value === "done" ? data.activities.length - openActivities.length : data.activities.length}</button>)}</div>
          <div className="lf-panel">{[...data.activities].filter(a => activityFilter === "all" || (activityFilter === "done" ? a.completed : !a.completed)).sort((a,b) => a.dueDate.localeCompare(b.dueDate)).map(item => <article className="lf-row lf-activity" key={item.id}><div><div className="lf-activity-title"><h3>{item.title}</h3><span className={`lf-pill ${!item.completed && item.dueDate <= today ? "lf-amber" : ""}`}>{item.completed ? "Completed" : item.dueDate < today ? "Overdue" : item.dueDate === today ? "Due today" : "Planned"}</span></div><p>Activity {dateLabel(item.date)} · Due {dateLabel(item.dueDate)}</p>{item.note && <p className="lf-activity-note">{item.note}</p>}</div><button className="lf-button lf-small" type="button" disabled={blocked || saving} onClick={() => save(next => { next.activities.find(a => a.id === item.id)!.completed = !item.completed; }, item.completed ? "Activity reopened." : "Activity marked complete.")}>{item.completed ? "Reopen" : "Mark done"}</button></article>)}{!data.activities.some(a => activityFilter === "all" || (activityFilter === "done" ? a.completed : !a.completed)) && <Empty title={activityFilter === "done" ? "No completed activities yet" : "No activities to show"}>Add your next job above, or switch the activity filter.</Empty>}</div>
        </>}
        {section === "settings" && <>
          <Heading eyebrow="05 / FARM & BACKUPS" title="Your farm. Your records.">Set the farm details and keep a portable copy of your work.</Heading>
          <section className="lf-panel"><h2>Farm settings</h2><Form key={`${data.settings.farmName}-${data.settings.currency}-${data.settings.timeZone}`} disabled={blocked || saving} submit="Save farm settings" onSave={form => save(next => { next.settings = { farmName: text(form, "name"), currency: text(form, "currency").toUpperCase(), timeZone: text(form, "zone") }; }, "Farm settings saved.")}><Field name="name" label="Farm name" maxLength={120} defaultValue={data.settings.farmName} required /><Field name="currency" label="Currency code" defaultValue={data.settings.currency} required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" placeholder="KES" /><Field name="zone" label="Time zone" defaultValue={data.settings.timeZone} required maxLength={80} placeholder="Africa/Nairobi" /></Form><p className="lf-help">Use a three-letter currency code and an IANA time zone, such as Africa/Nairobi. Dates and due-today alerts use the farm’s time zone. Quantities keep their recorded units.</p></section>
          <section className="lf-panel lf-backups"><h2>Back up and recover</h2><div className="lf-warning"><strong>This browser is the only working copy.</strong><p>Clearing site data, private browsing, browser eviction or losing this device can remove your records. The automatic previous version lives in the same browser. Download JSON backups and keep them somewhere safe.</p></div><div className="lf-backup-actions"><div><h3>Download a backup</h3><p>Export all operations records and farm settings as a JSON file.</p><button type="button" className="lf-button lf-primary" disabled={blocked || saving} onClick={exportBackup}>Export JSON backup</button></div><div><h3>Import a backup</h3><p>Choose a Thara operations backup. You can review it before replacing records.</p><label className="lf-field"><span>Backup JSON file</span><input type="file" accept=".json,application/json" disabled={saving} onChange={event => { void previewFile(event.target.files?.[0]); event.target.value = ""; }} /></label></div></div>
            {importPreview && <div className="lf-confirm" aria-labelledby="import-preview-title"><h3 id="import-preview-title">Review backup: {importPreview.name}</h3><p>Current records: {data.inventory.length} inventory items, {data.movements.length} movements, {data.equipment.length} equipment, {data.services.length} service logs and {data.activities.length} activities.</p><p>Farm: {importPreview.data.settings.farmName || "Unnamed farm"} · {importPreview.data.settings.currency} · {importPreview.data.settings.timeZone}</p><dl className="lf-preview-counts"><div><dt>Inventory items</dt><dd>{importPreview.data.inventory.length}</dd></div><div><dt>Movements</dt><dd>{importPreview.data.movements.length}</dd></div><div><dt>Equipment</dt><dd>{importPreview.data.equipment.length}</dd></div><div><dt>Service logs</dt><dd>{importPreview.data.services.length}</dd></div><div><dt>Activities</dt><dd>{importPreview.data.activities.length}</dd></div></dl><p><strong>This replaces all current operations records and settings.</strong> It does not merge records. Export the current version first if you want to keep it.</p><div className="lf-action-row"><button type="button" className="lf-button lf-primary" disabled={saving} onClick={() => void confirmImport()}>Replace records with this backup</button><button type="button" className="lf-button" onClick={() => setImportPreview(null)}>Cancel import</button></div></div>}
            <p className="lf-help">Backup download this session: {lastExport === null ? "Not yet requested." : data.revision > lastExport ? "Newer changes have not been exported." : "Requested for the current saved version; verify the file in your downloads."}</p><div className="lf-recovery"><h3>Restore the previous saved version</h3><p>{hasBackup ? "A previous saved version is available." : "No valid previous version is available."} A successful save keeps the preceding version in this browser. Restore replaces your current records; it cannot recover a cleared browser or another device.</p>{!restoreConfirm ? <button type="button" className="lf-button" disabled={!hasBackup || saving} onClick={() => { setRestoreConfirm(true); setImportPreview(null); }}>Review restore</button> : <div className="lf-confirm"><strong>Replace current records with the previous saved version?</strong><p>Changes made after that version will no longer be in your working records. Export the current version first if you need it. If no valid previous version exists, nothing will be changed.</p><div className="lf-action-row"><button type="button" className="lf-button lf-primary" disabled={saving} onClick={() => void restoreBackup()}>Confirm restore previous version</button><button type="button" className="lf-button" onClick={() => setRestoreConfirm(false)}>Cancel restore</button></div></div>}</div>
          <div className="lf-recovery"><h3>Preserve raw or older records</h3><p>Raw recovery files preserve unreadable operations storage. Legacy archives preserve other Thara records without importing them. These may contain private information; keep them safe. Neither is a standard operations backup.</p><div className="lf-action-row"><button className="lf-button" type="button" onClick={exportRaw}>Export raw recovery file</button><button className="lf-button" type="button" onClick={exportLegacy}>Export legacy archive</button></div></div></section><section className="lf-panel"><h2>About these records</h2><p className="lf-help">These operations records start empty and are separate from older sample screens. No legacy records are imported automatically. This dashboard uses no cloud service, model download or paid API.</p><button type="button" className="lf-button" onClick={reload}>Reload saved records</button></section>
        </>}
        <footer className="lf-footer"><span>THARA FARM</span><span>Local records · {data.settings.currency} · {data.settings.timeZone}</span></footer>
      </main>
    </div>
  </div>;
}
