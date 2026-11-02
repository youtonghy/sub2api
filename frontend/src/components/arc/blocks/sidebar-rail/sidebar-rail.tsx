"use client";

/**
 * App shell adapted from the Arc Pro sidebar-rail block (see NOTICE at the repository root).
 * The demo workspace data is replaced by props: navigation sections, the active entry, brand,
 * profile, top bar content and the page itself. Collapse and sheet state are controlled so the
 * app can keep them in its store.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type Ref } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { AnimatePresence, LayoutGroup, motion, useMotionValue, useReducedMotion, useTransform, type Transition } from "motion/react";
import { ChevronRight, X, type LucideIcon } from "lucide-react";
import { Tooltip } from "../../tooltip/tooltip";
import { motionTokens } from "../../lib/motion-tokens";
import styles from "./sidebar-rail.module.css";

const FULL = 240;
const RAIL = 64;
/** Below this shell width the sidebar leaves the layout and opens as a sheet. Matches the container query in the CSS. */
const COMPACT = 480;
/** Below this shell width the opened sidebar floats over the page from the rail instead of squeezing it, the way a tablet drawer does. */
const FLOAT = 640;
/** Below this shell width the sidebar starts as the icon rail, so the page keeps room to read. It can still be opened. */
const ROOMY = 760;
/** How long a picked row's highlight gets to land before a floating panel or sheet slides away. */
const SETTLE_MS = 200;

export interface SidebarEntry {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Custom icon markup (for example an admin-configured SVG). Used when `icon` is absent. */
  iconNode?: ReactNode;
  count?: number;
  children?: SidebarEntry[];
  /** Extra attributes for the row, such as ids the onboarding tour points at. */
  domId?: string;
  dataTour?: string;
}

export interface SidebarSection { id: string; heading?: string; items: SidebarEntry[] }

export interface SidebarRailLabels {
  navigation: string;
  expand: string;
  collapse: string;
  openNavigation: string;
  closeNavigation: string;
  unread?: (count: number) => string;
}

export interface SidebarRailProps {
  sections: SidebarSection[];
  /** Rows pinned to the bottom of the navigation. */
  footerItems?: SidebarEntry[];
  /** Id of the entry for the current page. */
  activeId: string | null;
  onSelect: (id: string) => void;
  brand: (collapsed: boolean) => ReactNode;
  profile?: (collapsed: boolean) => ReactNode;
  /** Content of the top bar after the sidebar toggle. */
  topbar: ReactNode;
  children: ReactNode;
  /** The scrolling page area, for resetting scroll on navigation. */
  contentRef?: Ref<HTMLDivElement>;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  labels: SidebarRailLabels;
}

const curve = (points: readonly number[]) => [...points] as [number, number, number, number];
const instant: Transition = { duration: 0 };

/** Labels leave quickly so they are gone a beat before the rail settles, and return a beat after the width starts opening. */
function labelTiming(collapsed: boolean, reduce: boolean): Transition {
  if (reduce) return instant;
  return collapsed ? { duration: .14, ease: curve(motionTokens.ease.standard) } : { duration: .24, delay: .1, ease: curve(motionTokens.ease.enter) };
}

/** Rail-only marks (dividers and unread dots) arrive once the labels have cleared, and leave first when the rail opens. */
function markTiming(collapsed: boolean, reduce: boolean): Transition {
  if (reduce) return instant;
  return collapsed ? { duration: .2, delay: .16, ease: curve(motionTokens.ease.enter) } : { duration: .1, ease: curve(motionTokens.ease.standard) };
}

function RailTip({ enabled, label, note, children }: { enabled: boolean; label: string; note?: string; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  // Closing the rail while a tip is open should not leave it armed for the next collapse.
  if (!enabled && open) setOpen(false);
  return <TooltipPrimitive.Root open={enabled && open} onOpenChange={next => setOpen(next && enabled)}>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content className={styles.tip} side="right" sideOffset={14} collisionPadding={8}>{label}{note && <span className={styles.tipNote}>{note}</span>}</TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>;
}

type RowProps = { entry: SidebarEntry; nested?: boolean; current: boolean; lit: boolean; expanded?: boolean; turned?: boolean; controls?: string; collapsed: boolean; tips: boolean; layoutId: string; reduce: boolean; unread?: (count: number) => string; onClick: () => void };

function NavRow({ entry, nested, current, lit, expanded, turned, controls, collapsed, tips, layoutId, reduce, unread, onClick }: RowProps) {
  const Icon = entry.icon;
  const fade = labelTiming(collapsed, reduce);
  const mark = markTiming(collapsed, reduce);
  const note = entry.count && unread ? unread(entry.count) : undefined;
  return <RailTip enabled={tips} label={entry.label} note={note}>
    <button type="button" id={entry.domId} data-tour={entry.dataTour} className={[styles.item, nested ? styles.nested : "", lit ? styles.lit : ""].join(" ")} aria-current={current ? "page" : undefined} aria-expanded={expanded} aria-controls={controls} onClick={onClick}>
      {lit && <motion.span layoutId={layoutId} className={styles.highlight} style={{ borderRadius: 8 }} transition={reduce ? instant : motionTokens.spring.morph} />}
      {Icon ? <Icon className={styles.icon} size={16} strokeWidth={1.75} aria-hidden="true" /> : entry.iconNode ? <span className={`${styles.icon} ${styles.customIcon}`} aria-hidden="true">{entry.iconNode}</span> : null}
      <motion.span className={styles.label} initial={false} animate={{ opacity: collapsed ? 0 : 1, x: collapsed ? -6 : 0 }} transition={fade}>{entry.label}{note ? <span className={styles.srOnly}>, {note}</span> : null}</motion.span>
      {entry.count ? <>
        <motion.span className={styles.count} aria-hidden="true" initial={false} animate={{ opacity: collapsed ? 0 : 1 }} transition={fade}>{entry.count}</motion.span>
        <motion.span className={styles.dot} aria-hidden="true" initial={false} animate={{ opacity: collapsed ? 1 : 0, scale: collapsed ? 1 : .3 }} transition={collapsed && !reduce ? { ...motionTokens.spring.snappy, delay: .16 } : mark} />
      </> : null}
      {turned !== undefined && <motion.span className={styles.chevron} aria-hidden="true" initial={false} animate={{ opacity: collapsed ? 0 : 1, rotate: turned ? 90 : 0 }} transition={{ opacity: fade, rotate: reduce ? instant : motionTokens.spring.snappy }}><ChevronRight size={14} strokeWidth={1.75} /></motion.span>}
    </button>
  </RailTip>;
}

type NavProps = { variant: "side" | "sheet"; baseId: string; sections: SidebarSection[]; footerItems: SidebarEntry[]; label: string; collapsed: boolean; active: string | null; open: (entry: SidebarEntry) => boolean; reduce: boolean; unread?: (count: number) => string; onSelect: (id: string) => void; onGroup: (entry: SidebarEntry) => void };

function Navigation({ variant, baseId, sections, footerItems, label, collapsed, active, open, reduce, unread, onSelect, onGroup }: NavProps) {
  const tips = variant === "side" && collapsed;
  const layoutId = `${variant}-active`;
  const fade = labelTiming(collapsed, reduce);
  const mark = markTiming(collapsed, reduce);
  const height = reduce ? instant : motionTokens.spring.smooth;
  const shared = { collapsed, tips, layoutId, reduce, unread };
  const row = (entry: SidebarEntry) => {
    if (!entry.children?.length) return <li key={entry.id}><NavRow entry={entry} current={active === entry.id} lit={active === entry.id} onClick={() => onSelect(entry.id)} {...shared} /></li>;
    const listId = `${baseId}-${variant}-${entry.id}-list`;
    const isOpen = open(entry);
    const shown = isOpen && !collapsed;
    const holdsActive = entry.children.some(child => child.id === active);
    return <li key={entry.id}>
      <NavRow entry={entry} current={false} lit={holdsActive && !shown} expanded={shown} turned={isOpen} controls={listId} onClick={() => onGroup(entry)} {...shared} />
      <motion.ul id={listId} className={styles.children} role="list" inert={!shown} initial={false} animate={shown ? { height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } } : { height: 0, opacity: 0, overflow: "hidden" }} transition={{ height, opacity: reduce ? instant : { duration: shown ? .24 : .14, delay: shown ? .06 : 0, ease: curve(motionTokens.ease.standard) } }}>
        {entry.children.map(child => <li key={child.id}><NavRow entry={child} nested current={active === child.id} lit={shown && active === child.id} onClick={() => onSelect(child.id)} {...shared} /></li>)}
      </motion.ul>
    </li>;
  };
  return <motion.nav className={styles.nav} aria-label={label} layoutScroll>
    {sections.map(section => {
      const headingId = `${baseId}-${variant}-${section.id}`;
      return <div key={section.id} className={styles.section} role={section.heading ? "group" : undefined} aria-labelledby={section.heading ? headingId : undefined}>
        {section.heading && <motion.div className={styles.heading} initial={false} animate={{ height: collapsed ? 17 : 32 }} transition={height}>
          <motion.span id={headingId} className={styles.headingText} initial={false} animate={{ opacity: collapsed ? 0 : 1, x: collapsed ? -6 : 0 }} transition={fade}>{section.heading}</motion.span>
          <motion.span className={styles.divider} aria-hidden="true" initial={false} animate={{ opacity: collapsed ? 1 : 0, scaleX: collapsed ? 1 : .3 }} transition={mark} />
        </motion.div>}
        <ul className={styles.list} role="list">{section.items.map(row)}</ul>
      </div>;
    })}
    {footerItems.length > 0 && <ul className={`${styles.list} ${styles.footerList}`} role="list">{footerItems.map(row)}</ul>}
  </motion.nav>;
}

/** The divider in the panel icon slides with the sidebar, so the control shows what it is about to do. */
function PanelGlyph({ collapsed, reduce }: { collapsed: boolean; reduce: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="3.5" />
    <motion.path d="M8.25 4.25v11.5" initial={false} animate={{ x: collapsed ? -2.5 : 0 }} transition={reduce ? instant : motionTokens.spring.smooth} />
  </svg>;
}

export function SidebarRail({ sections, footerItems = [], activeId, onSelect, brand, profile, topbar, children, contentRef, collapsed, onCollapsedChange, sheetOpen, onSheetOpenChange, labels }: SidebarRailProps) {
  const baseId = useId();
  const prefersReduced = !!useReducedMotion();
  // The first measurement settles the layout before paint, so it never animates.
  const [settling, setSettling] = useState(true);
  const reduce = prefersReduced || settling;
  const [floating, setFloating] = useState(false);
  // Groups open automatically while they hold the active entry; a click records the person's choice, which wins.
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({});
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const [status, setStatus] = useState("");
  const sheet = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const dragging = useRef(false);
  const closeTimer = useRef(0);
  const sidebarId = `${baseId}-sidebar`;
  const latest = useRef({ collapsed, sheetOpen, onCollapsedChange, onSheetOpenChange });
  useLayoutEffect(() => { latest.current = { collapsed, sheetOpen, onCollapsedChange, onSheetOpenChange }; });

  const isGroupOpen = (entry: SidebarEntry) => groupOverrides[entry.id] ?? !!entry.children?.some(child => child.id === activeId);

  // The [ shortcut toggles the rail, or the sheet when the shell is narrow. It stays out of text fields.
  useEffect(() => {
    if (!frame) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "[" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || !frame) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      const state = latest.current;
      if (frame.clientWidth < COMPACT) { state.onSheetOpenChange(!state.sheetOpen); return; }
      state.onCollapsedChange(!state.collapsed);
      setStatus(state.collapsed ? labels.expand : labels.collapse);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [frame, labels.expand, labels.collapse]);

  // A mid-width shell starts on the rail; crossing the threshold later folds or opens it once, and a sheet has no place in the wide layout.
  const roomy = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    if (!frame) return;
    const fit = () => {
      const width = frame.clientWidth;
      if (width >= COMPACT && latest.current.sheetOpen) latest.current.onSheetOpenChange(false);
      const floats = width >= COMPACT && width < FLOAT;
      setFloating(floats);
      const next = width >= ROOMY;
      if (roomy.current !== next) {
        // The first measurement keeps the stored choice on a roomy shell; later crossings fold or open the rail.
        if (roomy.current !== null || !next) latest.current.onCollapsedChange(!next);
        roomy.current = next;
      }
      // A panel left open while the shell narrows would cover the page, so it folds back to the rail.
      else if (floats && !latest.current.collapsed) latest.current.onCollapsedChange(true);
    };
    fit();
    const settle = requestAnimationFrame(() => setSettling(false));
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => { observer.disconnect(); cancelAnimationFrame(settle); };
  }, [frame]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  function toggleRail() {
    onCollapsedChange(!collapsed);
    setStatus(collapsed ? labels.expand : labels.collapse);
  }

  const overlaid = floating && !collapsed;

  function fold() {
    onCollapsedChange(true);
    setStatus(labels.collapse);
  }

  function select(id: string, fromSheet = false) {
    if (fromSheet && dragging.current) return;
    onSelect(id);
    if (!fromSheet && !overlaid) return;
    // Let the highlight arrive before the sheet or the floating panel slides away.
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => (fromSheet ? onSheetOpenChange(false) : onCollapsedChange(true)), reduce ? 0 : SETTLE_MS);
  }

  function toggleGroup(entry: SidebarEntry, fromSheet = false) {
    if (fromSheet && dragging.current) return;
    // In the rail a group has nowhere to open, so the sidebar widens to reveal it.
    if (collapsed && !fromSheet) {
      onCollapsedChange(false);
      setGroupOverrides(current => ({ ...current, [entry.id]: true }));
      setStatus(labels.expand);
      return;
    }
    setGroupOverrides(current => ({ ...current, [entry.id]: !isGroupOpen(entry) }));
  }

  // The scrim follows the sheet, so a drag to dismiss lightens the page under the finger instead of waiting for release.
  const sheetX = useMotionValue<number | string>("-100%");
  const scrimOpacity = useTransform(sheetX, value => {
    const width = sheet.current?.offsetWidth || 288;
    const shift = typeof value === "number" ? value / width : value.endsWith("%") ? parseFloat(value) / 100 : parseFloat(value) / width;
    return Math.min(1, Math.max(0, 1 + (Number.isFinite(shift) ? shift : -1)));
  });

  const navShared = { baseId, sections, footerItems, label: labels.navigation, active: activeId, open: isGroupOpen, reduce, unread: labels.unread };

  return <LayoutGroup id={baseId}>
    <TooltipPrimitive.Provider delayDuration={250} skipDelayDuration={300}>
      <div ref={setFrame} className={styles.shell} onKeyDown={event => { if (event.key === "Escape" && overlaid && !event.defaultPrevented) { event.preventDefault(); fold(); } }}>
        {/* The slot holds the sidebar's place in the row. On a floating shell it keeps the rail's width and the panel opens over the page. */}
        <motion.div className={styles.slot} initial={false} animate={{ width: floating || collapsed ? RAIL : FULL }} transition={reduce ? instant : motionTokens.spring.smooth}>
          <motion.aside id={sidebarId} className={styles.sidebar} initial={false} animate={{ width: collapsed ? RAIL : FULL }} transition={reduce ? instant : motionTokens.spring.smooth} data-collapsed={collapsed || undefined} data-floating={overlaid || undefined}>
            <div className={styles.brand}>{brand(collapsed)}</div>
            <Navigation variant="side" collapsed={collapsed} onSelect={id => select(id)} onGroup={entry => toggleGroup(entry)} {...navShared} />
            {profile && <div className={styles.profile}>{profile(collapsed)}</div>}
          </motion.aside>
        </motion.div>
        <AnimatePresence>
          {overlaid && <motion.div key="float-scrim" className={`${styles.scrim} ${styles.floatScrim}`} aria-hidden="true" onClick={fold} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reduce ? instant : { duration: motionTokens.duration.standard, ease: curve(motionTokens.ease.standard) }} />}
        </AnimatePresence>

        <div className={styles.main}>
          <header className={styles.topbar}>
            <Tooltip side="bottom" content={<span className={styles.shortcut}>{collapsed ? labels.expand : labels.collapse}<kbd>[</kbd></span>}>
              <button type="button" className={`${styles.iconButton} ${styles.railToggle}`} aria-label={collapsed ? labels.expand : labels.collapse} aria-expanded={!collapsed} aria-controls={sidebarId} aria-keyshortcuts="[" onClick={toggleRail}><PanelGlyph collapsed={collapsed} reduce={reduce} /></button>
            </Tooltip>
            <button ref={menuButton} type="button" className={`${styles.iconButton} ${styles.menuButton}`} aria-label={labels.openNavigation} aria-haspopup="dialog" aria-expanded={sheetOpen} aria-keyshortcuts="[" onClick={() => onSheetOpenChange(true)}><PanelGlyph collapsed={false} reduce={reduce} /></button>
            <div className={styles.topbarContent}>{topbar}</div>
          </header>
          <div ref={contentRef} className={styles.content}>{children}</div>
          <p className={styles.srOnly} role="status" aria-live="polite">{status}</p>
        </div>

        <Dialog.Root open={sheetOpen} onOpenChange={onSheetOpenChange}>
          <AnimatePresence>
            {sheetOpen && frame && <Dialog.Portal forceMount container={frame}>
              <Dialog.Overlay asChild forceMount><motion.div className={styles.scrim} style={{ opacity: scrimOpacity }} /></Dialog.Overlay>
              <Dialog.Content asChild forceMount aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); menuButton.current?.focus({ preventScroll: true }); }} onOpenAutoFocus={event => { const current = sheet.current?.querySelector<HTMLElement>("[aria-current='page']"); if (current && !current.closest("[inert]")) { event.preventDefault(); current.focus(); } }}>
                <motion.div ref={sheet} className={styles.sheet} style={{ x: sheetX }} initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={reduce ? instant : motionTokens.spring.smooth}
                  drag={prefersReduced ? false : "x"} dragConstraints={{ left: 0, right: 0 }} dragElastic={{ left: .9, right: .04 }} dragMomentum={false}
                  onDragStart={() => { dragging.current = true; sheet.current?.setAttribute("data-dragging", ""); }}
                  onDragEnd={(_, info) => { sheet.current?.removeAttribute("data-dragging"); window.setTimeout(() => { dragging.current = false; }, 0); if (info.offset.x < -72 || info.velocity.x < -480) onSheetOpenChange(false); }}>
                  <Dialog.Title className={styles.srOnly}>{labels.navigation}</Dialog.Title>
                  <div className={styles.sheetHead}>
                    <div className={styles.brand}>{brand(false)}</div>
                    <Dialog.Close asChild><button type="button" className={styles.iconButton} aria-label={labels.closeNavigation}><X size={18} strokeWidth={1.75} aria-hidden="true" /></button></Dialog.Close>
                  </div>
                  <Navigation variant="sheet" collapsed={false} onSelect={id => select(id, true)} onGroup={entry => toggleGroup(entry, true)} {...navShared} />
                  {profile && <div className={styles.profile}>{profile(false)}</div>}
                </motion.div>
              </Dialog.Content>
            </Dialog.Portal>}
          </AnimatePresence>
        </Dialog.Root>
      </div>
    </TooltipPrimitive.Provider>
  </LayoutGroup>;
}

export default SidebarRail;
