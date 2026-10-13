// Browser key (KeyboardEvent.code) -> MIDP key code the game receives.
//
// The game reads input as bitmasks (see e.X() and its e.F()/e.G() checks), and every
// gameplay/menu check already accepts the d-pad and the matching digit together:
//   up|2 = jump, down|8 = crouch, left|4, right|6, fire|5 = attack,
//   left soft|fire|5 = confirm, right soft = back / weapon upgrade.
// So standard web controls map straight onto the d-pad codes, with no game changes needed.
//
// Two hands: WASD + J/K/L, or arrows + Z/X/C. Codes use physical key positions, so the
// layout stays in place on AZERTY/QWERTZ keyboards.
export const KEYMAP = {
  // Move / jump / crouch (also menu navigation)
  ArrowUp: -1, KeyW: -1, Space: -1,
  ArrowDown: -2, KeyS: -2,
  ArrowLeft: -3, KeyA: -3,
  ArrowRight: -4, KeyD: -4,

  // Diagonal jumps (phone keys 1 / 3)
  KeyQ: 49,
  KeyE: 51,

  // Actions
  KeyJ: 53, KeyZ: 53,   // attack (phone 5)
  KeyK: 48, KeyX: 48,   // magic (phone 0)
  KeyL: 57, KeyC: 57,   // switch weapon (phone 9)

  // Soft keys
  // Enter is a context-aware OK (1000 = sodweb.Input.VK_OK): the left soft key on most
  // screens, Fire on the weapon-upgrade screen, where holding it fills the power bar.
  Enter: 1000,
  KeyP: -6,                            // pause menu / Next (left soft key)
  Escape: -7, Backspace: -7, KeyU: -7, // Back / weapon upgrade (right soft key)
};
