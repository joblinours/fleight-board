import { describe, expect, it } from 'vitest';
import {
  type InputHandlers,
  type InputMode,
  InputRouter,
  PEN_COOLDOWN_MS,
  type PointerInput,
  type PointerKind,
} from './input-router';

type Call = [keyof InputHandlers, ...unknown[]];

function setup(mode: InputMode = 'auto') {
  const calls: Call[] = [];
  const router = new InputRouter(
    {
      drawStart: (pointer, sample) => calls.push(['drawStart', pointer.id, sample.x, sample.y]),
      drawMove: (pointer, samples) => calls.push(['drawMove', pointer.id, samples.length]),
      drawEnd: (pointer) => calls.push(['drawEnd', pointer.id]),
      drawCancel: (pointer) => calls.push(['drawCancel', pointer.id]),
      pan: (dx, dy) => calls.push(['pan', dx, dy]),
      zoom: (anchor, factor) => calls.push(['zoom', anchor.x, anchor.y, factor]),
      palmRejected: (id) => calls.push(['palmRejected', id]),
    },
    mode,
  );

  let time = 0;
  const send = (
    phase: PointerInput['phase'],
    id: number,
    kind: PointerKind,
    x = 0,
    y = 0,
    extra: Partial<PointerInput> = {},
  ) => {
    time += 10;
    router.handle({ id, kind, phase, samples: [{ x, y, pressure: 0.5, time }], ...extra });
  };
  const wait = (ms: number) => {
    time += ms;
  };
  const names = () => calls.map(([name]) => name);

  return { router, calls, send, wait, names };
}

describe('InputRouter — dessin', () => {
  it('dessine au stylet', () => {
    const { send, calls } = setup();
    send('down', 1, 'pen', 5, 6);
    send('move', 1, 'pen', 7, 8);
    send('up', 1, 'pen', 7, 8);

    expect(calls).toEqual([
      ['drawStart', 1, 5, 6],
      ['drawMove', 1, 1],
      ['drawEnd', 1],
    ]);
  });

  it('transmet tous les échantillons fusionnés d’un move', () => {
    const { router, calls, send } = setup();
    send('down', 1, 'pen');
    router.handle({
      id: 1,
      kind: 'pen',
      phase: 'move',
      samples: [1, 2, 3].map((x) => ({ x, y: 0, pressure: 0.5, time: 100 + x })),
    });

    expect(calls.at(-1)).toEqual(['drawMove', 1, 3]);
  });

  it('dessine au bouton gauche de la souris, navigue au bouton du milieu', () => {
    const { send, names } = setup();
    send('down', 1, 'mouse', 0, 0, { button: 0 });
    send('up', 1, 'mouse');
    send('down', 1, 'mouse', 0, 0, { button: 1 });
    send('move', 1, 'mouse', 10, 5);
    send('up', 1, 'mouse');
    send('down', 1, 'mouse', 0, 0, { button: 2 });
    send('move', 1, 'mouse', 10, 5);

    expect(names()).toEqual(['drawStart', 'drawEnd', 'pan']);
  });

  it('annule le trait sur pointercancel', () => {
    const { send, names } = setup();
    send('down', 1, 'pen');
    send('cancel', 1, 'pen');

    expect(names()).toEqual(['drawStart', 'drawCancel']);
  });

  it('ignore le survol (move sans down)', () => {
    const { send, calls } = setup();
    send('move', 1, 'pen', 3, 3);
    send('move', 2, 'mouse', 3, 3);

    expect(calls).toEqual([]);
  });
});

describe('InputRouter — doigt selon le mode', () => {
  it('auto : le doigt dessine tant qu’aucun stylet n’a été vu', () => {
    const { send, names } = setup('auto');
    send('down', 1, 'touch');
    send('up', 1, 'touch');

    expect(names()).toEqual(['drawStart', 'drawEnd']);
  });

  it('auto : après un stylet, le doigt navigue', () => {
    const { router, send, wait, calls } = setup('auto');
    send('down', 1, 'pen');
    send('up', 1, 'pen');
    wait(PEN_COOLDOWN_MS);
    calls.length = 0;

    send('down', 2, 'touch', 0, 0);
    send('move', 2, 'touch', 30, 40);

    expect(router.penDetected).toBe(true);
    expect(calls).toEqual([['pan', 30, 40]]);
  });

  it('pencil-only : le doigt ne dessine jamais', () => {
    const { send, names } = setup('pencil-only');
    send('down', 1, 'touch');
    send('move', 1, 'touch', 5, 0);

    expect(names()).toEqual(['pan']);
  });

  it('touch-drawing : le doigt dessine même après un stylet', () => {
    const { send, wait, names } = setup('touch-drawing');
    send('down', 1, 'pen');
    send('up', 1, 'pen');
    wait(PEN_COOLDOWN_MS);
    send('down', 2, 'touch');

    expect(names()).toEqual(['drawStart', 'drawEnd', 'drawStart']);
  });
});

describe('InputRouter — palm rejection', () => {
  it('ignore un contact tactile pendant que le stylet est posé', () => {
    const { send, names } = setup('touch-drawing');
    send('down', 1, 'pen');
    send('down', 2, 'touch');
    send('move', 2, 'touch', 50, 50);
    send('up', 2, 'touch');
    send('move', 1, 'pen', 1, 1);
    send('up', 1, 'pen');

    expect(names()).toEqual(['drawStart', 'palmRejected', 'drawMove', 'drawEnd']);
  });

  it('ignore les contacts tactiles juste après le levé du stylet', () => {
    const { send, wait, names } = setup('touch-drawing');
    send('down', 1, 'pen');
    send('up', 1, 'pen');
    wait(PEN_COOLDOWN_MS / 2);
    send('down', 2, 'touch');
    send('up', 2, 'touch');
    wait(PEN_COOLDOWN_MS);
    send('down', 3, 'touch');

    expect(names()).toEqual(['drawStart', 'drawEnd', 'palmRejected', 'drawStart']);
  });

  it('annule un trait tactile commencé par la paume quand le stylet se pose', () => {
    const { send, calls } = setup('touch-drawing');
    send('down', 1, 'touch');
    send('move', 1, 'touch', 3, 3);
    send('down', 2, 'pen', 100, 100);
    send('move', 1, 'touch', 6, 6); // la paume continue de bouger : ignorée

    expect(calls).toEqual([
      ['drawStart', 1, 0, 0],
      ['drawMove', 1, 1],
      ['drawCancel', 1],
      ['drawStart', 2, 100, 100],
    ]);
  });

  it('cesse de naviguer avec les doigts quand le stylet se pose', () => {
    const { send, names } = setup('pencil-only');
    send('down', 1, 'touch');
    send('down', 2, 'pen');
    send('move', 1, 'touch', 40, 0);

    expect(names()).toEqual(['drawStart']);
  });
});

describe('InputRouter — navigation tactile', () => {
  it('un doigt déplace la vue', () => {
    const { send, calls } = setup('pencil-only');
    send('down', 1, 'touch', 10, 10);
    send('move', 1, 'touch', 15, 4);

    expect(calls).toEqual([['pan', 5, -6]]);
  });

  it('deux doigts zooment autour de leur centre', () => {
    const { send, calls } = setup('pencil-only');
    send('down', 1, 'touch', 0, 0);
    send('down', 2, 'touch', 100, 0);
    // Le second doigt s'éloigne : écartement 100 → 200.
    send('move', 2, 'touch', 200, 0);

    expect(calls).toEqual([
      ['pan', 50, 0],
      ['zoom', 100, 0, 2],
    ]);
  });

  it('un second doigt transforme un trait au doigt en pinch', () => {
    const { send, names } = setup('touch-drawing');
    send('down', 1, 'touch', 0, 0);
    send('move', 1, 'touch', 2, 0);
    send('down', 2, 'touch', 100, 0);
    send('move', 2, 'touch', 150, 0);

    expect(names()).toEqual(['drawStart', 'drawMove', 'drawCancel', 'pan', 'zoom']);
  });

  it('reset annule le trait en cours', () => {
    const { router, send, names } = setup();
    send('down', 1, 'pen');
    router.reset();
    send('move', 1, 'pen', 5, 5);

    expect(names()).toEqual(['drawStart', 'drawCancel']);
    expect(router.isDrawing).toBe(false);
  });
});
