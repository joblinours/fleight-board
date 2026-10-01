import type { InputRouter, PointerInput, PointerKind, PointerSample } from './input-router';

export type DomInputOptions = {
  /** Défilement à la molette, en pixels écran. */
  onWheelPan(dx: number, dy: number): void;
  /** Zoom à la molette (Ctrl/⌘) ou au pinch du trackpad. */
  onWheelZoom(anchor: { x: number; y: number }, factor: number): void;
  /** Événement brut reçu (statistiques et débogage). */
  onRawEvent?(event: PointerEvent, samples: readonly PointerSample[]): void;
};

/**
 * Relie un élément du DOM à l'InputRouter : Pointer Events (avec événements fusionnés),
 * molette, et neutralisation des gestes natifs du navigateur (Safari iPadOS notamment).
 * Retourne la fonction de nettoyage.
 */
export function attachDomInput(
  element: HTMLElement,
  router: InputRouter,
  options: DomInputOptions,
): () => void {
  const toSample = (event: PointerEvent, rect: DOMRect): PointerSample => ({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    pressure: event.pressure,
    time: event.timeStamp,
  });

  const forward = (event: PointerEvent, phase: PointerInput['phase']) => {
    const rect = element.getBoundingClientRect();
    const coalesced = phase === 'move' ? coalescedEvents(event) : [];
    const samples =
      coalesced.length > 0
        ? coalesced.map((item) => toSample(item, rect))
        : [toSample(event, rect)];
    options.onRawEvent?.(event, samples);
    router.handle({
      id: event.pointerId,
      kind: pointerKind(event.pointerType),
      phase,
      samples,
      button: event.button,
    });
  };

  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    // Garder les événements même si le pointeur sort de l'élément.
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Pointeur déjà relâché ou synthétique : la capture est facultative.
    }
    forward(event, 'down');
  };
  const onPointerMove = (event: PointerEvent) => forward(event, 'move');
  const onPointerUp = (event: PointerEvent) => forward(event, 'up');
  const onPointerCancel = (event: PointerEvent) => forward(event, 'cancel');

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
    if (event.ctrlKey || event.metaKey) {
      // Pinch du trackpad (ctrlKey) ou Ctrl/⌘ + molette.
      options.onWheelZoom(anchor, Math.exp(-event.deltaY * scale * 0.01));
    } else {
      options.onWheelPan(-event.deltaX * scale, -event.deltaY * scale);
    }
  };

  // Gestes natifs à neutraliser : zoom Safari, menu contextuel, loupe, double-tap.
  const prevent = (event: Event) => event.preventDefault();
  const onBlur = () => router.reset();

  const listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions?]> = [
    [element, 'pointerdown', onPointerDown as EventListener],
    [element, 'pointermove', onPointerMove as EventListener],
    [element, 'pointerup', onPointerUp as EventListener],
    [element, 'pointercancel', onPointerCancel as EventListener],
    [element, 'wheel', onWheel as EventListener, { passive: false }],
    [element, 'contextmenu', prevent],
    [element, 'dblclick', prevent],
    [element, 'touchstart', prevent, { passive: false }],
    [element, 'touchmove', prevent, { passive: false }],
    [element, 'gesturestart', prevent],
    [element, 'gesturechange', prevent],
    [element, 'gestureend', prevent],
    [window, 'blur', onBlur],
  ];
  for (const [target, type, listener, listenerOptions] of listeners) {
    target.addEventListener(type, listener, listenerOptions);
  }

  return () => {
    for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
    router.reset();
  };
}

export function pointerKind(pointerType: string): PointerKind {
  return pointerType === 'pen' || pointerType === 'touch' ? pointerType : 'mouse';
}

function coalescedEvents(event: PointerEvent): PointerEvent[] {
  // getCoalescedEvents n'existe pas partout (anciennes versions de Safari).
  return typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
}
