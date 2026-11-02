"use client";

/**
 * Adapted from the Arc Pro uptime-status block (https://uiarc.dev/components/blocks/uptime-status).
 * Local changes: the status header and uptime strips are driven by props instead of the bundled sample data,
 * the slot count, labels and tooltip rows are configurable, an "idle" slot state covers periods without data,
 * and the response time chart, incident timeline, service selection and simulation button are removed.
 */
import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { AnimatePresence, motion, useIsPresent, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { TriangleAlert } from "lucide-react";
import { AnimatedCounter } from "../../animated-counter/animated-counter";
import { Badge } from "../../badge/badge";
import { motionTokens } from "../../lib/motion-tokens";
import styles from "./uptime-status.module.css";

export type UptimeSlotStatus = "operational" | "degraded" | "outage" | "idle";

export interface UptimeSlot {
  status: UptimeSlotStatus;
  /** Heading in the tooltip, e.g. a date or an hour range. */
  label: string;
  /** Uptime of this slot in percent; omitted for slots without data. */
  uptime?: number;
  /** Extra label/value rows in the tooltip. */
  details?: { label: string; value: string }[];
}

export interface UptimeService {
  id: string;
  name: string;
  detail?: string;
  /** Overall uptime in percent; null hides the number. */
  uptime: number | null;
  /** Oldest first. Every service should carry the same number of slots. */
  slots: UptimeSlot[];
  /** Shown next to the name when the service is not operational. */
  issue?: { tone: "warning" | "danger"; label: string };
}

export interface UptimeStatusLabels {
  operational: string;
  degraded: string;
  outage: string;
  idle: string;
  uptime: string;
  noData: string;
  /** Accessible name of a strip. */
  strip: (service: string) => string;
  /** Hint read after a strip's summary. */
  keyboardHint: string;
}

export interface UptimeStatusProps {
  services: UptimeService[];
  /** Overall state of the header. */
  state: "operational" | "degraded";
  title: string;
  /** Source shown before the detail line, e.g. the page name. */
  source?: string;
  detail?: string;
  panelTitle: string;
  panelDescription?: string;
  /** Labels under the strips, at the first and the last slot. */
  axis?: [string, string];
  labels: UptimeStatusLabels;
  /** Slots moved by Page up / Page down. */
  pageStep?: number;
  /** Formatting locale for the uptime numbers. */
  locale?: string;
  /** Replaces the rows, e.g. while loading or when there is nothing to show. */
  placeholder?: ReactNode;
  /** Rendered between the header and the uptime panel, e.g. an error alert. */
  notice?: ReactNode;
  className?: string;
}

const { spring, duration, ease } = motionTokens;
const enterEase = [...ease.enter] as [number, number, number, number];
const standardEase = [...ease.standard] as [number, number, number, number];
/** The tooltip trails the pointer by a short, critically damped beat and retargets on every move. */
const follow = { visualDuration: .16, bounce: 0 };
const TIP_W = 256;
/** Bars dip on bad slots, so severity reads from shape as well as color. */
const BAR_HEIGHT = 34;
const DIP: Record<UptimeSlotStatus, number> = { operational: 1, degraded: .64, outage: .34, idle: 1 };
const LEGEND: UptimeSlotStatus[] = ["operational", "degraded", "outage", "idle"];
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

/** Measured content width. ResizeObserver reports once on observe, so the first measure needs no effect-time state. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => { const next = Math.round(entry.contentRect.width); if (next) setWidth(next); });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Outgoing copies are hidden from assistive tech while they leave. The ref lets popLayout measure the leaving copy. */
function Phrase({ children, reduce, ref }: { children: ReactNode; reduce: boolean; ref?: Ref<HTMLSpanElement> }) {
  const present = useIsPresent();
  return <motion.span ref={ref} className={styles.swapText} aria-hidden={present ? undefined : true}
    initial={reduce ? { opacity: 0 } : { opacity: 0, y: "0.3em" }} animate={{ opacity: 1, y: "0em" }}
    exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: "-0.25em", transition: { duration: duration.fast, ease: standardEase } }}
    transition={reduce ? { duration: 0 } : { duration: duration.standard, ease: enterEase }}>{children}</motion.span>;
}

/** Changing copy rises in while the old line lifts away out of flow. */
function Swap({ text, className }: { text: string; className?: string }) {
  const reduce = !!useReducedMotion();
  return <span className={cx(styles.swap, className)}><AnimatePresence mode="popLayout" initial={false}><Phrase key={text} reduce={reduce}>{text}</Phrase></AnimatePresence></span>;
}

/** Severity as a small bar that dips like the slot bars, so the legend and tooltip share one shape. */
function StatusMark({ status }: { status: UptimeSlotStatus }) {
  const height = Math.round(14 * DIP[status]);
  return <svg className={styles.mark} data-status={status} width="8" height="14" viewBox="0 0 8 14" aria-hidden="true"><rect x="0" y={14 - height} width="8" height={height} rx="1.5" /></svg>;
}

/** A check whose two strokes travel into an exclamation mark: the short stroke shrinks to the dot, the long one stands up. */
const GLYPH = { ok: [[6.1, 10.3, 8.8, 13], [8.8, 13, 14, 7.4]], warn: [[10, 14.1, 10, 14.1], [10, 5.8, 10, 10.9]] };
function StatusGlyph({ degraded }: { degraded: boolean }) {
  const reduce = useReducedMotion();
  const lines = degraded ? GLYPH.warn : GLYPH.ok;
  return <svg className={styles.glyph} viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="10" />
    {lines.map(([x1, y1, x2, y2], index) => <motion.line key={index} initial={false} animate={{ x1, y1, x2, y2 }} transition={reduce ? { duration: 0 } : { ...spring.morph, delay: index * .04 }} />)}
  </svg>;
}

export function UptimeStatus({ services, state, title, source, detail, panelTitle, panelDescription, axis, labels, pageStep = 7, locale = "en-US", placeholder, notice, className }: UptimeStatusProps) {
  const titleId = useId();
  const degraded = state === "degraded";
  return <section className={cx(styles.root, className)} aria-labelledby={titleId}>
    <header className={styles.status} data-state={degraded ? "degraded" : "operational"}>
      <StatusGlyph degraded={degraded} />
      <div className={styles.statusText}>
        <h2 id={titleId} className={styles.title}><Swap text={title} /></h2>
        {source || detail ? <p className={styles.statusDetail}>
          {source ? <span>{source}</span> : null}
          {source && detail ? <span aria-hidden="true">·</span> : null}
          {detail ? <Swap text={detail} /> : null}
        </p> : null}
      </div>
    </header>
    {notice}
    <UptimePanel services={services} title={panelTitle} description={panelDescription} axis={axis} labels={labels} pageStep={pageStep} locale={locale} placeholder={placeholder} />
  </section>;
}

type Tip = { service: string; slot: number; width: number };
type PanelProps = Pick<UptimeStatusProps, "services" | "axis" | "labels" | "placeholder"> & { title: string; description?: string; pageStep: number; locale: string };

function UptimePanel({ services, title, description, axis, labels, pageStep, locale, placeholder }: PanelProps) {
  const reduce = !!useReducedMotion();
  const headId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [live, setLive] = useState("");
  const tipX = useMotionValue(0), tipY = useMotionValue(0);
  const springX = useSpring(tipX, follow), springY = useSpring(tipY, follow);
  const percent = useMemo(() => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), [locale]);
  const statusLabel = (status: UptimeSlotStatus) => labels[status];

  function inspect(service: UptimeService, slot: number, strip: HTMLElement, center: number, keyboard: boolean) {
    const panel = panelRef.current;
    if (!panel) return;
    const outer = panel.getBoundingClientRect(), rect = strip.getBoundingClientRect();
    const width = Math.min(TIP_W, outer.width - 16);
    const x = Math.round(clamp(rect.left - outer.left + center - width / 2, 8, outer.width - width - 8)), y = Math.round(rect.top - outer.top - 8);
    tipX.set(x); tipY.set(y);
    // A tooltip that appears starts over its bar; only later moves glide.
    if (!tip) { springX.jump(x); springY.jump(y); }
    setTip({ service: service.id, slot, width });
    if (keyboard) setLive(describe(service.slots[slot]));
  }

  function describe(slot: UptimeSlot) {
    const parts = [`${slot.label}: ${statusLabel(slot.status)}`];
    if (slot.uptime !== undefined) parts.push(`${percent.format(slot.uptime)}% ${labels.uptime}`);
    for (const row of slot.details ?? []) parts.push(`${row.label} ${row.value}`);
    return `${parts.join(", ")}.`;
  }

  const active = tip ? services.find(service => service.id === tip.service) : undefined;
  const slot = active && tip ? active.slots[tip.slot] : undefined;
  return <section ref={panelRef} className={styles.panel} aria-labelledby={headId}>
    <div className={styles.panelHead}>
      <div>
        <h3 id={headId}>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      <ul className={styles.legend} aria-label="Legend">
        {LEGEND.map(status => <li key={status}><StatusMark status={status} />{statusLabel(status)}</li>)}
      </ul>
    </div>
    {placeholder ?? <>
      <div className={styles.rows}>
        {services.map(service => <ServiceRow key={service.id} service={service} labels={labels} percent={percent} locale={locale} pageStep={pageStep}
          hover={tip?.service === service.id ? tip.slot : null} reduce={reduce} statusLabel={statusLabel}
          onInspect={(index, strip, center, keyboard) => inspect(service, index, strip, center, keyboard)} onLeave={() => setTip(null)} />)}
      </div>
      {axis ? <div className={styles.axis} aria-hidden="true"><span>{axis[0]}</span><span>{axis[1]}</span></div> : null}
    </>}
    <AnimatePresence>
      {tip && active && slot && <motion.div key="tip" className={styles.tip} aria-hidden="true" style={{ x: reduce ? tipX : springX, y: reduce ? tipY : springY, width: tip.width }}
        initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .98, transition: { duration: duration.instant, ease: standardEase } }}
        transition={reduce ? { duration: 0 } : { duration: duration.fast, ease: enterEase }}>
        <div className={styles.tipHead}><span>{active.name} · {slot.label}</span>{slot.uptime !== undefined ? <span className={styles.num}>{percent.format(slot.uptime)}%</span> : null}</div>
        <div className={styles.tipStatus}><StatusMark status={slot.status} />{statusLabel(slot.status)}</div>
        {slot.details?.length ? <ul className={styles.tipList}>{slot.details.map(row => <li key={row.label}><span>{row.label}</span><span className={styles.num}>{row.value}</span></li>)}</ul>
          : <p className={styles.tipEmpty}>{labels.noData}</p>}
      </motion.div>}
    </AnimatePresence>
    <p className={styles.srOnly} aria-live="polite">{live}</p>
  </section>;
}

function barLayout(width: number, count: number) {
  const gap = width < 420 ? 1 : 2, pitch = (width + gap) / Math.max(1, count);
  return Array.from({ length: count }, (_, index) => { const x = Math.round(index * pitch); return { x, w: Math.max(1, Math.round((index + 1) * pitch - gap) - x) }; });
}

type Bar = { x: number; w: number };
/** Bars sit in a flipped group, so a bad slot dips from the top by animating height alone. Memoized so hovering never re-renders every bar. */
const Bars = memo(function Bars({ slots, bars, radius, reduce }: { slots: UptimeSlot[]; bars: Bar[]; radius: number; reduce: boolean }) {
  return <g className={styles.bars}>
    {slots.map((slot, index) => <motion.rect key={index} className={styles.bar} data-status={slot.status} x={bars[index].x} y={0} width={bars[index].w} rx={radius}
      initial={false} animate={{ height: Math.round(BAR_HEIGHT * DIP[slot.status]) }} transition={reduce ? { duration: 0 } : spring.morph} />)}
  </g>;
});

type RowProps = {
  service: UptimeService; labels: UptimeStatusLabels; percent: Intl.NumberFormat; locale: string; pageStep: number; hover: number | null; reduce: boolean;
  statusLabel: (status: UptimeSlotStatus) => string;
  onInspect: (slot: number, strip: HTMLElement, center: number, keyboard: boolean) => void; onLeave: () => void;
};

function ServiceRow({ service, labels, percent, locale, pageStep, hover, reduce, statusLabel, onInspect, onLeave }: RowProps) {
  const summaryId = useId();
  const [stripRef, width] = useWidth<HTMLDivElement>(640);
  const { slots } = service;
  const last = Math.max(0, slots.length - 1);
  const bars = useMemo(() => barLayout(width, slots.length), [width, slots.length]);
  const radius = width / Math.max(1, slots.length) > 4 ? 1.5 : .75;
  const bad = slots.flatMap(slot => slot.status === "degraded" || slot.status === "outage" ? [`${slot.label} ${statusLabel(slot.status)}`] : []);
  const summary = `${service.uptime === null ? "" : `${percent.format(service.uptime)}% ${labels.uptime}. `}${bad.length ? `${bad.join("; ")}. ` : ""}${labels.keyboardHint}`;

  function inspect(slot: number, keyboard: boolean) {
    const strip = stripRef.current;
    if (!strip || !bars[slot]) return;
    const scale = strip.getBoundingClientRect().width / width;
    onInspect(slot, strip, (bars[slot].x + bars[slot].w / 2) * scale, keyboard);
  }
  const slotAt = (clientX: number, strip: HTMLElement) => { const rect = strip.getBoundingClientRect(); return clamp(Math.floor((clientX - rect.left) / Math.max(1, rect.width) * slots.length), 0, last); };
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = hover ?? last;
    const moves: Record<string, number> = { ArrowLeft: current - 1, ArrowRight: current + 1, PageUp: current - pageStep, PageDown: current + pageStep, Home: 0, End: last };
    if (event.key === "Escape") return onLeave();
    if (!(event.key in moves)) return;
    event.preventDefault();
    inspect(clamp(moves[event.key], 0, last), true);
  }

  const lit = hover === null ? null : slots[hover];
  return <div className={styles.row}>
    <div className={styles.rowHead}>
      <span className={styles.rowName}><span className={styles.rowTitle} title={service.name}>{service.name}</span>{service.detail ? <span className={styles.rowDetail}>{service.detail}</span> : null}</span>
      {service.issue ? <Badge size="sm" tone={service.issue.tone} icon={<TriangleAlert size={12} strokeWidth={2} />}>{service.issue.label}</Badge> : <span className={styles.srOnly}>{labels.operational}</span>}
      {service.uptime !== null ? <span className={styles.rowUptime}><span className={styles.num}><AnimatedCounter value={service.uptime} decimals={2} suffix="%" locale={locale} /></span><span className={styles.rowUptimeLabel}>{labels.uptime}</span></span> : null}
    </div>
    <div ref={stripRef} className={styles.strip} tabIndex={0} role="group" aria-label={labels.strip(service.name)} aria-describedby={summaryId} data-active={lit ? "" : undefined}
      onPointerMove={event => inspect(slotAt(event.clientX, event.currentTarget), false)} onPointerDown={event => inspect(slotAt(event.clientX, event.currentTarget), false)}
      onPointerLeave={onLeave} onBlur={onLeave} onKeyDown={onKeyDown}
      onFocus={event => { if (event.currentTarget.matches(":focus-visible")) inspect(hover ?? last, true); }}>
      <svg width="100%" height={BAR_HEIGHT} viewBox={`0 0 ${width} ${BAR_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <g transform={`matrix(1 0 0 -1 0 ${BAR_HEIGHT})`}>
          <Bars slots={slots} bars={bars} radius={radius} reduce={reduce} />
          {lit && hover !== null && bars[hover] && <rect className={styles.bar} data-status={lit.status} data-lit="" x={bars[hover].x} y={0} width={bars[hover].w} height={Math.round(BAR_HEIGHT * DIP[lit.status])} rx={radius} />}
        </g>
      </svg>
      <span id={summaryId} className={styles.srOnly}>{summary}</span>
    </div>
  </div>;
}

export default UptimeStatus;
