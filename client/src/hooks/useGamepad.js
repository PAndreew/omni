import { useEffect, useRef } from 'react';

// Standard gamepad button indices — works with PS4 DualShock 4, PS5 DualSense, Xbox controllers
const BTN = {
  CROSS:       0,   // PS Cross / Xbox A — confirm/select
  CIRCLE:      1,   // PS Circle / Xbox B — back/cancel
  SQUARE:      2,   // PS Square / Xbox X
  TRIANGLE:    3,   // PS Triangle / Xbox Y
  L1:          4,
  R1:          5,
  L2:          6,
  R2:          7,
  SHARE:       8,   // PS Share/Create / Xbox View
  OPTIONS:     9,   // PS Options / Xbox Menu
  L3:          10,
  R3:          11,
  DPAD_UP:     12,
  DPAD_DOWN:   13,
  DPAD_LEFT:   14,
  DPAD_RIGHT:  15,
  PS:          16,
};

const INITIAL_DELAY_MS = 300;   // ms before first repeat fires
const REPEAT_DELAY_MS  = 150;   // ms between subsequent repeats
const STICK_DEAD       = 0.45;  // analog stick deadzone

export function useGamepad({
  onUp, onDown, onLeft, onRight,
  onSelect, onBack,
  onOptions,
  onL1, onR1,
  enabled = true,
}) {
  const cbRef = useRef({});
  cbRef.current = { onUp, onDown, onLeft, onRight, onSelect, onBack, onOptions, onL1, onR1 };

  useEffect(() => {
    if (!enabled) return;
    if (!navigator.getGamepads) return;

    // held: Map<key, { since: number, lastFired: number }>
    const held = new Map();

    function fire(key, handlerName) {
      const handler = cbRef.current[handlerName];
      if (!handler) return;
      const now = performance.now();
      const state = held.get(key);
      if (!state) {
        handler();
        held.set(key, { since: now, lastFired: now });
      } else if (now - state.lastFired > REPEAT_DELAY_MS) {
        handler();
        state.lastFired = now;
      }
    }

    function release(key) {
      held.delete(key);
    }

    let raf;
    function poll() {
      const gamepads = navigator.getGamepads();
      for (const gp of gamepads) {
        if (!gp) continue;

        const btnCheck = (idx, key, handlerName) => {
          if (gp.buttons[idx]?.pressed) fire(key, handlerName);
          else release(key);
        };

        btnCheck(BTN.DPAD_UP,    'du',  'onUp');
        btnCheck(BTN.DPAD_DOWN,  'dd',  'onDown');
        btnCheck(BTN.DPAD_LEFT,  'dl',  'onLeft');
        btnCheck(BTN.DPAD_RIGHT, 'dr',  'onRight');
        btnCheck(BTN.CROSS,      'sel', 'onSelect');
        btnCheck(BTN.CIRCLE,     'bck', 'onBack');
        btnCheck(BTN.OPTIONS,    'opt', 'onOptions');
        btnCheck(BTN.L1,         'l1',  'onL1');
        btnCheck(BTN.R1,         'r1',  'onR1');

        // Left analog stick
        const ax = gp.axes[0] ?? 0;
        const ay = gp.axes[1] ?? 0;
        if (ax >  STICK_DEAD) fire('sax_r', 'onRight'); else release('sax_r');
        if (ax < -STICK_DEAD) fire('sax_l', 'onLeft');  else release('sax_l');
        if (ay >  STICK_DEAD) fire('say_d', 'onDown');  else release('say_d');
        if (ay < -STICK_DEAD) fire('say_u', 'onUp');    else release('say_u');
      }
      raf = requestAnimationFrame(poll);
    }

    const onConnect    = (e) => console.log('[Gamepad] Connected:',    e.gamepad.id);
    const onDisconnect = (e) => console.log('[Gamepad] Disconnected:', e.gamepad.id);

    window.addEventListener('gamepadconnected',    onConnect);
    window.addEventListener('gamepaddisconnected', onDisconnect);
    raf = requestAnimationFrame(poll);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('gamepadconnected',    onConnect);
      window.removeEventListener('gamepaddisconnected', onDisconnect);
    };
  }, [enabled]);
}
