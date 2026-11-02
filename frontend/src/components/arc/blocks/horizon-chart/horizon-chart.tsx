"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type Transition } from "motion/react";
import SegmentedControl from "../../segmented-control/segmented-control";
import { motionTokens } from "../../lib/motion-tokens";
import {
  horizonDays, horizonDescription, horizonMonthTicks, horizonSeries, horizonTitle,
  type HorizonDay, type HorizonSeries, type HorizonSort,
} from "./horizon-chart-data";
import styles from "./horizon-chart.module.css";

export type { HorizonDay, HorizonSeries, HorizonSort } from "./horizon-chart-data";

export type HorizonBands = 1 | 2 | 3 | 4;

export interface HorizonChartProps {
  /** One row per series. Every series has one value per day, as a signed distance from its baseline. */
  series?: HorizonSeries[];
  /** Days on the shared x axis, oldest first. */
  days?: HorizonDay[];
  /** Labels on the x axis, each at a day index. */
  ticks?: { index: number; label: string }[];
  title?: string;
  /** Line under the title. Pass an empty string to hide it. */
  description?: string;
  /** What the values are measured against, used in the legend and for screen readers. */
  baselineLabel?: string;
  /** Opening row order. */
  defaultSort?: HorizonSort;
  /** Opening number of bands each row folds into. */
  defaultBands?: HorizonBands;
  /** Distance from the baseline that fills every band. Larger values stay in the darkest band. Defaults to the largest value rounded up to a multiple of 12. */
  extent?: number;
  /** Formats a value for rows, the legend and screen readers. */
  formatValue?: (value: number) => string;
  onSortChange?: (sort: HorizonSort) => void;
  onBandsChange?: (bands: HorizonBands) => void;
  /** Called when the synced crosshair moves to a day, or with null when it leaves. */
  onDayChange?: (index: number | null) => void;
  /** Text shown or announced by the chart, for translation. */
  labels?: Partial<HorizonChartLabels>;
  className?: string;
}

export interface HorizonChartLabels {
  sort: string;
  sortRows: string;
  sortName: string;
  sortPeak: string;
  sortLatest: string;
  sortedBy: Record<HorizonSort, string>;
  bands: string;
  bandCount: string;
  /** Announced after a band change, such as "3 bands of 4%". */
  bandsOf: (count: number, step: string) => string;
  latestDay: string;
  selectedDay: string;
  below: string;
  above: string;
  /** Legend caption with one band. */
  oneBandCaption: (extent: string, baseline: string) => string;
  /** Legend caption with several bands. */
  bandsCaption: (count: number, step: string, baseline: string) => string;
  colorScale: (extent: string, baseline: string, count: number) => string;
  empty: string;
  rows: (count: number) => string;
  keyboardHint: string;
  /** Announced when the crosshair moves by keyboard. */
  dayExtremes: (day: string, top: string, topValue: string, bottom: string, bottomValue: string) => string;
  tableCaption: (title: string, baseline: string) => string;
  rowHeader: string;
  latestHeader: string;
  highestHeader: string;
  lowestHeader: string;
  /** A value with the day it happened, such as "+12% on Aug 4". */
  valueOn: (value: string, day: string) => string;
}

const DEFAULT_LABELS: HorizonChartLabels = {
  sort: "Sort",
  sortRows: "Sort rows",
  sortName: "Name",
  sortPeak: "Peak",
  sortLatest: "Latest",
  sortedBy: { name: "Rows sorted by name.", peak: "Rows sorted by largest swing.", latest: "Rows sorted by latest value." },
  bands: "Bands",
  bandCount: "Band count",
  bandsOf: (count, step) => `${count === 1 ? "One band" : `${count} bands`} of ${step}.`,
  latestDay: "Latest day",
  selectedDay: "Selected day",
  below: "Below",
  above: "Above",
  oneBandCaption: (extent, baseline) => `With one band, each row is a plain area chart up to ${extent} from the ${baseline}.`,
  bandsCaption: (count, step, baseline) => `Each row folds into ${count} bands of ${step}. Stronger color means further from the ${baseline}.`,
  colorScale: (extent, baseline, count) => `Color scale from ${extent} below to ${extent} above the ${baseline}, in ${count === 1 ? "one band" : `${count} bands`} per side.`,
  empty: "No series to show yet. Add a series with daily values to draw its row.",
  rows: count => `${count} rows`,
  keyboardHint: "Use the left and right arrow keys to move the crosshair by one day, Shift with an arrow for one week, Home and End for the first and last day, and Escape to clear it.",
  dayExtremes: (day, top, topValue, bottom, bottomValue) => `${day}. Highest ${top} ${topValue}, lowest ${bottom} ${bottomValue}.`,
  tableCaption: (title, baseline) => `${title}, values against the ${baseline}`,
  rowHeader: "Row",
  latestHeader: "Latest",
  highestHeader: "Highest",
  lowestHeader: "Lowest",
  valueOn: (value, day) => `${value} on ${day}`,
};

const { spring } = motionTokens;
/** Rows travel to their new place on one critically damped spring, a little longer because they cross the list. */
const reorder: Transition = { ...spring.smooth, visualDuration: .55 };
/** Bands fold and unfold on the same no-overshoot character, so the chart never shows a band count that is not true. */
const fold: Transition = { ...spring.smooth, visualDuration: .6 };
/** The crosshair trails the pointer by a short beat and lands exactly on the day it reports. */
const follow: Transition = { type: "spring", visualDuration: .16, bounce: 0 };
const instant: Transition = { duration: 0 };

/** Every row always draws four layers per side; a layer above the current band count covers values past the extent, so it stays empty. */
const layers = [0, 1, 2, 3] as const;
/** Opacity at which the darkest band tops out, whatever the band count. */
const topIntensity = .92;
/** Each layer carries the same opacity, so stacked layers grow darker band by band and the top band reaches topIntensity. */
const layerAlpha = (bands: number) => 1 - Math.pow(1 - topIntensity, 1 / Math.max(1, bands));
const bandIntensity = (band: number, bands: number) => 1 - Math.pow(1 - layerAlpha(bands), band + 1);

const bandOptions = [1, 2, 3, 4].map(value => ({ value: String(value), label: String(value) }));

/** A legend swatch: bands past the current count fold to zero width and fade, so the ramp resizes instead of snapping. */
const swatchStyle = (band: number, bands: number) => (band < bands
  ? { "--grow": 1, opacity: bandIntensity(band, bands) }
  : { "--grow": 0, opacity: 0 }) as CSSProperties;

function defaultFormat(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "0%";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}%`;
}

function formatStep(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

/** An area from the zero line up to the clipped magnitude, in a unit box: x is the day index, y runs from 0 to -1. */
function areaPath(values: number[], pick: (value: number) => number, extent: number): string {
  if (values.length === 0) return "";
  let d = "M0,0";
  values.forEach((value, i) => {
    const y = Math.min(Math.max(pick(value), 0), extent) / extent;
    d += `L${i},${y === 0 ? 0 : -Math.round(y * 10000) / 10000}`;
  });
  return `${d}L${values.length - 1},0Z`;
}

export function HorizonChart({
  series = horizonSeries,
  days = horizonDays,
  ticks = horizonMonthTicks,
  title = horizonTitle,
  description = horizonDescription,
  baselineLabel = "spring average",
  defaultSort = "peak",
  defaultBands = 3,
  extent: extentProp,
  formatValue = defaultFormat,
  onSortChange,
  onBandsChange,
  onDayChange,
  labels: labelsProp,
  className,
}: HorizonChartProps) {
  const labels = { ...DEFAULT_LABELS, ...labelsProp };
  const sortOptions: { value: HorizonSort; label: string }[] = [
    { value: "name", label: labels.sortName },
    { value: "peak", label: labels.sortPeak },
    { value: "latest", label: labels.sortLatest },
  ];
  const id = useId();
  const reduce = useReducedMotion();
  const [sort, setSort] = useState<HorizonSort>(defaultSort);
  const [bands, setBands] = useState<HorizonBands>(defaultBands);
  // The first band count is written into the root style once; later changes animate the same custom properties directly.
  const [initialBands] = useState<HorizonBands>(defaultBands);
  const [announcement, setAnnouncement] = useState("");

  const last = Math.max(0, days.length - 1);
  const extent = useMemo(() => {
    if (extentProp && extentProp > 0) return extentProp;
    let max = 0;
    for (const item of series) for (const value of item.values) max = Math.max(max, Math.abs(value));
    // A multiple of 12 splits evenly into 1, 2, 3 and 4 bands, so every band count has a round step.
    return Math.max(12, Math.ceil(max / 12) * 12);
  }, [extentProp, series]);

  const rows = useMemo(() => series.map(item => {
    let peak = 0, peakIndex = 0, high = -Infinity, highIndex = 0, low = Infinity, lowIndex = 0;
    item.values.forEach((value, i) => {
      if (Math.abs(value) > Math.abs(peak)) { peak = value; peakIndex = i; }
      if (value > high) { high = value; highIndex = i; }
      if (value < low) { low = value; lowIndex = i; }
    });
    return {
      ...item,
      latest: item.values[last] ?? 0,
      peak, peakIndex, high, highIndex, low, lowIndex,
      above: areaPath(item.values, value => value, extent),
      below: areaPath(item.values, value => -value, extent),
    };
  }), [series, extent, last]);

  const ordered = useMemo(() => {
    const list = [...rows];
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name, "en"));
    else if (sort === "peak") list.sort((a, b) => Math.abs(b.peak) - Math.abs(a.peak) || a.name.localeCompare(b.name, "en"));
    else list.sort((a, b) => b.latest - a.latest || a.name.localeCompare(b.name, "en"));
    return list;
  }, [rows, sort]);

  /* Band count: one motion value drives two custom properties on the root, so every layer in every row folds together. */
  const rootRef = useRef<HTMLElement>(null);
  const bandsValue = useMotionValue<number>(initialBands);
  useEffect(() => {
    const apply = (value: number) => {
      const node = rootRef.current;
      if (!node) return;
      node.style.setProperty("--bands", String(value));
      node.style.setProperty("--alpha", layerAlpha(value).toFixed(4));
    };
    return bandsValue.on("change", apply);
  }, [bandsValue]);
  useEffect(() => {
    if (reduce) { bandsValue.set(bands); return; }
    const controls = animate(bandsValue, bands, fold);
    return () => controls.stop();
  }, [bands, reduce, bandsValue]);

  /* Crosshair: day changes write straight to the DOM, so scrubbing never renders React. */
  const dayRef = useRef<number | null>(null);
  const valueNodes = useRef(new Map<string, HTMLSpanElement>());
  const dateNode = useRef<HTMLSpanElement>(null);
  const stateNode = useRef<HTMLSpanElement>(null);
  const crossNode = useRef<HTMLDivElement>(null);
  const hitNode = useRef<HTMLDivElement>(null);
  const crossX = useMotionValue(100);
  const crossLeft = useTransform(crossX, value => `${value}%`);
  const crossAnimation = useRef<ReturnType<typeof animate> | null>(null);
  const seriesRef = useRef(rows);
  const labelsRef = useRef(labels);
  const daysRef = useRef(days);
  const formatRef = useRef(formatValue);
  const dayChangeRef = useRef(onDayChange);
  useEffect(() => {
    seriesRef.current = rows;
    daysRef.current = days;
    formatRef.current = formatValue;
    dayChangeRef.current = onDayChange;
    labelsRef.current = labels;
  });

  const writeDay = (index: number | null) => {
    const shown = index ?? last;
    for (const row of seriesRef.current) {
      const text = valueNodes.current.get(row.id)?.firstChild;
      if (text) text.nodeValue = formatRef.current(row.values[shown] ?? 0);
    }
    const date = dateNode.current?.firstChild;
    if (date) date.nodeValue = daysRef.current[shown]?.long ?? "";
    const state = stateNode.current?.firstChild;
    if (state) state.nodeValue = index === null ? labelsRef.current.latestDay : labelsRef.current.selectedDay;
  };

  const showDay = (index: number | null) => {
    const previous = dayRef.current;
    if (index === previous) return;
    dayRef.current = index;
    writeDay(index);
    crossNode.current?.toggleAttribute("data-on", index !== null);
    if (index !== null) {
      const target = last === 0 ? 0 : (index / last) * 100;
      crossAnimation.current?.stop();
      if (reduce || previous === null) crossX.set(target);
      else crossAnimation.current = animate(crossX, target, follow);
    }
    dayChangeRef.current?.(index);
  };

  // Values written to the DOM must follow a new sort or new data, since React renders the latest day.
  useEffect(() => {
    if (dayRef.current !== null) writeDay(dayRef.current);
  });

  const dayFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = hitNode.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const share = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return Math.round(share * last);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => { showDay(dayFromPointer(event)); };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" || event.buttons > 0) showDay(dayFromPointer(event));
  };
  const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    // A tap keeps its day on touch screens so the values stay readable; a mouse clears it on leave.
    if (event.pointerType === "mouse" && document.activeElement !== event.currentTarget.closest("[data-chart]")) showDay(null);
  };

  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (announceTimer.current) clearTimeout(announceTimer.current); }, []);
  const announceDay = (index: number) => {
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => {
      const list = seriesRef.current;
      if (list.length === 0) return;
      let top = list[0], bottom = list[0];
      for (const row of list) {
        if ((row.values[index] ?? 0) > (top.values[index] ?? 0)) top = row;
        if ((row.values[index] ?? 0) < (bottom.values[index] ?? 0)) bottom = row;
      }
      const format = formatRef.current;
      setAnnouncement(labelsRef.current.dayExtremes(daysRef.current[index]?.long ?? "", top.name, format(top.values[index] ?? 0), bottom.name, format(bottom.values[index] ?? 0)));
    }, 220);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = dayRef.current ?? last;
    const step = event.shiftKey ? 7 : 1;
    let next: number | null | undefined;
    if (event.key === "ArrowLeft") next = Math.max(0, current - step);
    else if (event.key === "ArrowRight") next = Math.min(last, current + step);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === "Escape") next = null;
    if (next === undefined) return;
    event.preventDefault();
    showDay(next);
    if (next !== null) announceDay(next);
  };

  const onFocus = () => { if (dayRef.current === null) { showDay(last); announceDay(last); } };
  const onBlur = () => showDay(null);

  const changeSort = (value: string) => {
    const next = value as HorizonSort;
    setSort(next);
    setAnnouncement(labels.sortedBy[next]);
    onSortChange?.(next);
  };
  const changeBands = (value: string) => {
    const next = Number(value) as HorizonBands;
    setBands(next);
    setAnnouncement(labels.bandsOf(next, formatStep(extent / next)));
    onBandsChange?.(next);
  };

  const step = formatStep(extent / bands);
  const caption = bands === 1
    ? labels.oneBandCaption(formatStep(extent), baselineLabel)
    : labels.bandsCaption(bands, step, baselineLabel);

  const rootStyle = { "--bands": initialBands, "--alpha": layerAlpha(initialBands).toFixed(4) } as CSSProperties;
  const latestDay = days[last];

  return <section ref={rootRef} className={`${styles.root} ${className ?? ""}`} style={rootStyle} aria-labelledby={`${id}-title`}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <h2 id={`${id}-title`} className={styles.title}>{title}</h2>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      <div className={styles.controls}>
        <div className={styles.control}>
          <span className={styles.controlLabel} aria-hidden="true">{labels.sort}</span>
          <SegmentedControl className={styles.segment} label={labels.sortRows} options={sortOptions} value={sort} onValueChange={changeSort} />
        </div>
        <div className={styles.control}>
          <span className={styles.controlLabel} aria-hidden="true">{labels.bands}</span>
          <SegmentedControl className={styles.segment} label={labels.bandCount} options={bandOptions} value={String(bands)} onValueChange={changeBands} />
        </div>
      </div>
    </header>

    <div className={styles.readout}>
      <p className={styles.when}>
        <span ref={dateNode} className={styles.date}>{latestDay?.long ?? ""}</span>
        <span ref={stateNode} className={styles.state}>{labels.latestDay}</span>
      </p>
      <div className={styles.legend}>
        <div className={styles.scale} role="img" aria-label={labels.colorScale(formatStep(extent), baselineLabel, bands)}>
          <div className={styles.ramp}>
            {[...layers].reverse().map(band => <span key={`b${band}`} className={styles.swatchBelow} style={swatchStyle(band, bands)} />)}
            <span className={styles.zero} />
            {layers.map(band => <span key={`a${band}`} className={styles.swatchAbove} style={swatchStyle(band, bands)} />)}
          </div>
          <div className={styles.scaleLabels} aria-hidden="true">
            <span className={styles.scaleEnd}>{"−"}{formatStep(extent)}</span>
            <span className={styles.scaleSide}>{labels.below}</span>
            <span className={styles.scaleZero}>0</span>
            <span className={styles.scaleSide}>{labels.above}</span>
            <span className={styles.scaleEnd}>+{formatStep(extent)}</span>
          </div>
        </div>
        <p className={styles.caption}>{caption}</p>
      </div>
    </div>

    {rows.length === 0 ? <p className={styles.empty}>{labels.empty}</p> : <>
      <div
        className={styles.chart}
        data-chart=""
        tabIndex={0}
        role="group"
        aria-label={`${title}. ${labels.rows(rows.length)}`}
        aria-describedby={`${id}-hint`}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <div className={styles.body}>
        <ol className={styles.rows}>
          {ordered.map(row => <motion.li key={row.id} layout="position" transition={reduce ? instant : reorder} className={styles.row}>
            <span className={styles.name} title={row.name}>{row.name}</span>
            <span className={styles.plot}>
              <svg className={styles.svg} viewBox={`0 0 ${Math.max(1, last)} 1`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
                {layers.map(layer => <path key={`b${layer}`} className={styles.below} d={row.below} style={{ "--layer": layer + 1 } as CSSProperties} />)}
                {layers.map(layer => <path key={`a${layer}`} className={styles.above} d={row.above} style={{ "--layer": layer + 1 } as CSSProperties} />)}
              </svg>
            </span>
            <span className={styles.value} ref={node => { if (node) valueNodes.current.set(row.id, node); else valueNodes.current.delete(row.id); }}>{formatValue(row.latest)}</span>
          </motion.li>)}
        </ol>

        <div className={styles.overlay} aria-hidden="true">
          <div ref={crossNode} className={styles.crossLayer}>
            <motion.span className={styles.crossTrack} style={{ x: crossLeft }}><span className={styles.crossLine} /></motion.span>
          </div>
          <div
            ref={hitNode}
            className={styles.hit}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
          />
        </div>
        </div>

        <div className={styles.axis} aria-hidden="true">
          <span className={styles.axisTrack}>
            {ticks.filter(tick => tick.index >= 0 && tick.index <= last).map(tick => <span key={`${tick.index}-${tick.label}`} className={styles.tick} style={{ left: `${last === 0 ? 0 : (tick.index / last) * 100}%` }}>{tick.label}</span>)}
          </span>
        </div>
      </div>

      <p id={`${id}-hint`} className={styles.srOnly}>{labels.keyboardHint}</p>
      <div className={styles.srOnly}><table>
        <caption>{labels.tableCaption(title, baselineLabel)}</caption>
        <thead><tr><th scope="col">{labels.rowHeader}</th><th scope="col">{labels.latestHeader}</th><th scope="col">{labels.highestHeader}</th><th scope="col">{labels.lowestHeader}</th></tr></thead>
        <tbody>
          {ordered.map(row => <tr key={row.id}>
            <th scope="row">{row.name}</th>
            <td>{formatValue(row.latest)}</td>
            <td>{labels.valueOn(formatValue(row.high), days[row.highIndex]?.short ?? "")}</td>
            <td>{labels.valueOn(formatValue(row.low), days[row.lowIndex]?.short ?? "")}</td>
          </tr>)}
        </tbody>
      </table></div>
    </>}
    <p className={styles.srOnly} role="status" aria-live="polite">{announcement}</p>
  </section>;
}

export default HorizonChart;
