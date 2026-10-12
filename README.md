# Godbox Earth

A 3D god-game on a procedural globe (three.js). You are the people's one true god. They have their own minds, and belief is theirs to give.

**Play:** https://dominicvii.github.io/godbox/

## Controls
- Drag to orbit, use the wheel to zoom from orbit down to the ground, double-click to fly somewhere. Right-drag or Q/E turns the view. F follows the selected person.
- Pick a power from the palette (Create / Bless / Destroy / Terrain / People / Time / World) or press its key, then click the globe. The ring shows the power's reach. A click that misses tells you why.
- Space pauses, - and = change speed, [ and ] change the brush size, / opens the Codex, ? opens help, Esc closes things.
- To move a panel, drag its title bar. ▾ folds it and double-clicking the title resets its place.

## Plug-in powers: `GB.registerPower(def)`
```js
GB.registerPower({
  id: 'locusts', name: 'Locusts', icon: '🦗', group: 'Destroy', // Create|Bless|Destroy|Terrain|People|Time, or a new group
  radius: 6,            // tiles; number or (params)=>number. Drawn as the cursor ring
  key: 'n',             // optional hotkey. If it clashes, a free key is chosen and the tooltip says so
  paint: false,         // true = keeps applying while you drag
  params: { radius: 6 },// editable in the options strip; params.options = { name: [choices] } makes a dropdown
  hint: 'Eat the harvest',
  apply(ctx) {          // ctx: x, y (tiles), radius, params, people, kingdom, nation, civ, world, mind,
                        //      notify(ev), log(s), chronicle(s), toast(s, ok), ask(title, ph) -> Promise,
                        //      fx.rain(), fx.lightning(), fx.ring(color, radius, secs)
    if (!ctx.people.length) return { miss: 'No one here.' };   // shows feedback instead of a silent miss
    ctx.people.forEach(p => p.hunger += 40);
    return { message: `Locusts strip the fields of ${ctx.people.length}.` };
  }
});   // returns an unregister function
```
`godbox-powers.js` (rain, drought, bless/curse a nation, vision, raise/sink land, plague, heal, lightning, feast) is wired through this API. Its hotkeys follow the module's own, except Feast, which moves from F (Follow) to Z.
