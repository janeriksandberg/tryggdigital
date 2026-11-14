import { t } from '../../i18n.js';
import { h } from '../../ui.js';
import { pageHead } from './index.js';
import { board } from '../foreman.js';
import { actor } from '../shared.js';
export function render() { return h('div', { class: 'stack' }, pageHead(t('nav.foreman'), t('foreman.text')), board({ by: actor() })); }
export const onData = (ev, ctx) => ctx.redraw();
