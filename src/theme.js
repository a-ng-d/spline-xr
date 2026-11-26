// Yelbolt brand: design tokens from Unoff UI (@unoff/ui), CSS only.
// The page sets data-theme="yelbolt" and a data-mode (palette + light/dark)
// on <html>; index.html maps the app's own variables onto these tokens.
import '@unoff-styles/tokens/modules/commons.css'       // radii, durations, spacing…
import '@unoff-styles/tokens/modules/yelbolt-colors.css' // palettes (ylb, uno, isb…)
import '@unoff-styles/tokens/modules/yelbolt-modes.css'  // semantic colours per data-mode
import '@unoff-styles/texts/styles/yelbolt.css'          // text styles
// Lexend, served with the app (the theme's own stylesheet fetches it from
// Google Fonts)
import '@fontsource-variable/lexend'
import './styles/unoff-yelbolt-components.generated.css'  // button, input, card… tokens
