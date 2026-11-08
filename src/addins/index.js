// Bundled add-ins. esbuild inlines the JSON, so nothing is fetched at run time; a new add-in
// is a new folder here plus one line below. Order is the list order in Settings.
import flagDecision from './flag-decision/manifest.json';
import actions from './actions/manifest.json';

export const BUNDLED = [flagDecision, actions];
